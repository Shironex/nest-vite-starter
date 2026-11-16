/**
 * Proof that the tenant-membership advisory lock actually EXECUTES, against the
 * LIVE docker Postgres. Excluded from the fast jest lane; runs via the
 * integration config:
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * Here because a raw query is the one thing in this codebase a mock cannot
 * stand in for. The unit
 * specs beside this file mock Prisma, so the statement never runs there, and
 * `psql` executes it happily, so hand-checking the SQL proves nothing about the
 * client that would issue it. `pg_advisory_xact_lock()` returns `void`, which
 * the Prisma query engine cannot deserialize, so the same statement written
 * with `$queryRaw` would throw P2010 on every demotion and no other lane would
 * notice.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { barrier, delay, raceAll } from '@test/concurrency';
import { esmImport } from '../../common/utils/esm-import';
import type { PrismaService } from '../../common/database/prisma.service';
import { UserRepository } from './user.repository';

let unscoped: PrismaClient;
let repository: UserRepository;

beforeAll(async () => {
  // The exported singleton, not `new PrismaClient()`: Prisma 7 requires a
  // driver adapter and `@repo/database` is where that is configured.
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  repository = new UserRepository({
    client: unscoped,
    unscoped,
  } as unknown as PrismaService);
});

describe('lockTenantMembership against real Postgres', () => {
  it('executes without a deserialization error', async () => {
    const tenantId = randomUUID();

    await expect(
      unscoped.$transaction(async (tx) => {
        await repository.lockTenantMembership(tenantId, tx);
        return 'locked';
      }),
    ).resolves.toBe('locked');
  });

  /**
   * A demotion takes the lock and then reads; nothing in that path takes it
   * twice today, but a future caller that wraps one guarded write in another
   * must not deadlock against itself.
   */
  it('is re-entrant within one transaction', async () => {
    const tenantId = randomUUID();

    await expect(
      unscoped.$transaction(async (tx) => {
        await repository.lockTenantMembership(tenantId, tx);
        await repository.lockTenantMembership(tenantId, tx);
        return 'twice';
      }),
    ).resolves.toBe('twice');
  });

  /**
   * The cases below are the ones that make this file mean anything.
   *
   * Everything above runs inside ONE transaction, which cannot observe waiting
   * at all: a transaction never blocks on a lock it already holds, so the old
   * "does not serialize two different organizations" case would have passed just as
   * well against a lock that serialized every organization on earth. These two open
   * two transactions and make them compete, and the assertion is the ORDER the
   * two sides recorded.
   */
  it('serializes two transactions competing for the same organization', async () => {
    const tenantId = randomUUID();
    const order: string[] = [];
    const bothStarted = barrier(2);

    const holder = unscoped.$transaction(async (tx) => {
      await repository.lockTenantMembership(tenantId, tx);
      order.push('a: holds');
      await bothStarted();
      // Long enough that b has certainly reached its lock and is waiting.
      await delay(150);
      order.push('a: commits');
    });

    const waiter = unscoped.$transaction(async (tx) => {
      await bothStarted();
      await repository.lockTenantMembership(tenantId, tx);
      order.push('b: holds');
    });

    await Promise.all([holder, waiter]);

    // b's lock was granted only after a's transaction ended. Without the lock
    // the middle entry would be last.
    expect(order).toEqual(['a: holds', 'a: commits', 'b: holds']);
  });

  /**
   * Two organizations must never wait on each other. The key is hashed per tenant into
   * the 32-bit advisory space, so a collision would cost an unnecessary wait
   * and nothing else; against two random uuids that is the harmless direction
   * and vanishingly unlikely.
   */
  it('does not serialize two transactions on different organizations', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const order: string[] = [];
    const bothStarted = barrier(2);

    const holder = unscoped.$transaction(async (tx) => {
      await repository.lockTenantMembership(a, tx);
      await bothStarted();
      await delay(150);
      order.push('a: commits');
    });

    const other = unscoped.$transaction(async (tx) => {
      await bothStarted();
      await repository.lockTenantMembership(b, tx);
      order.push('b: holds');
    });

    await Promise.all([holder, other]);

    expect(order).toEqual(['b: holds', 'a: commits']);
  });

  it('lets exactly one transaction inside the lock at a time under a burst', async () => {
    const tenantId = randomUUID();
    let inside = 0;
    let mostAtOnce = 0;

    const outcomes = await raceAll(4, () =>
      unscoped.$transaction(async (tx) => {
        await repository.lockTenantMembership(tenantId, tx);
        inside += 1;
        mostAtOnce = Math.max(mostAtOnce, inside);
        await delay(25);
        inside -= 1;
        return 'done';
      }),
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(4).fill('fulfilled'));
    expect(mostAtOnce).toBe(1);
  });
});
