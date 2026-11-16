/**
 * Proof that the admin-set advisory lock actually EXECUTES, against the LIVE
 * docker Postgres. Excluded from the fast jest lane; runs via the integration
 * config:
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * Here because a raw query is the one thing in this codebase a mock cannot
 * stand in for. The unit specs beside this file mock Prisma, so the statement
 * never runs there, and `psql` executes it happily, so hand-checking the SQL
 * proves nothing about the client that would issue it. `pg_advisory_xact_lock()`
 * returns `void`, which the Prisma query engine cannot deserialize, so the same
 * statement written with `$queryRaw` would throw P2010 on every demotion and no
 * other lane would notice.
 */
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { barrier, delay, raceAll } from '@test/concurrency';
import { esmImport } from '../../common/utils/esm-import';
import type { PrismaService } from '../../common/database/prisma.service';
import { UserRepository } from './user.repository';

let prisma: PrismaClient;
let repository: UserRepository;

beforeAll(async () => {
  // The exported singleton, not `new PrismaClient()`: Prisma 7 requires a
  // driver adapter and `@repo/database` is where that is configured.
  ({ prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient });
  repository = new UserRepository({ client: prisma } as unknown as PrismaService);
});

describe('lockAdminSet against real Postgres', () => {
  it('executes without a deserialization error', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await repository.lockAdminSet(tx);
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
    await expect(
      prisma.$transaction(async (tx) => {
        await repository.lockAdminSet(tx);
        await repository.lockAdminSet(tx);
        return 'twice';
      }),
    ).resolves.toBe('twice');
  });

  /**
   * The cases below are the ones that make this file mean anything.
   *
   * Everything above runs inside ONE transaction, which cannot observe waiting
   * at all: a transaction never blocks on a lock it already holds. These open
   * two transactions and make them compete, and the assertion is the ORDER the
   * two sides recorded.
   */
  it('serializes two competing transactions', async () => {
    const order: string[] = [];
    const bothStarted = barrier(2);

    const holder = prisma.$transaction(async (tx) => {
      await repository.lockAdminSet(tx);
      order.push('a: holds');
      await bothStarted();
      // Long enough that b has certainly reached its lock and is waiting.
      await delay(150);
      order.push('a: commits');
    });

    const waiter = prisma.$transaction(async (tx) => {
      await bothStarted();
      await repository.lockAdminSet(tx);
      order.push('b: holds');
    });

    await Promise.all([holder, waiter]);

    // b's lock was granted only after a's transaction ended. Without the lock
    // the middle entry would be last.
    expect(order).toEqual(['a: holds', 'a: commits', 'b: holds']);
  });

  it('lets exactly one transaction inside the lock at a time under a burst', async () => {
    let inside = 0;
    let mostAtOnce = 0;

    const outcomes = await raceAll(4, () =>
      prisma.$transaction(async (tx) => {
        await repository.lockAdminSet(tx);
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
