/**
 * Proof that the acceptance transaction behaves as designed against the LIVE
 * docker Postgres. Excluded from the fast jest lane; runs via the integration
 * config:
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * Every case here asserts something the unit specs beside it CANNOT see,
 * because they mock Prisma:
 *
 *   - `User.tenantId` is `onDelete: Restrict`, which is the whole reason
 *     `isAbandonable` counts soft-deleted rows;
 *   - `Workspace.tenant` is `onDelete: Cascade`, which is the whole reason the
 *     transaction runs at Serializable;
 *   - the tenant-scope extension fails closed without an ALS tenant, which is
 *     the whole reason the counts run inside `requestContext.run`;
 *   - a moved account reads the organization it moved INTO and not the one it left.
 *
 * A mocked Prisma answers whatever the spec tells it to, so none of these
 * statements is testable anywhere else in the repo.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { esmImport } from '../../../common/utils/esm-import';
import { requestContext } from '../../../common/context/request-context';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import { StaffInviteRepository } from './staff-invite.repository';
import type { PrismaService } from '../../../common/database/prisma.service';

let unscoped: PrismaClient;
let client: PrismaClient;
let repository: StaffInviteRepository;

const createdTenantIds = new Set<string>();
const createdUserIds = new Set<string>();

const run = <T>(tenantId: string | undefined, fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: 'staff-invite-iso', tenantId }, fn);

const makeTenant = async (label: string) => {
  const uid = randomUUID();
  const tenant = await unscoped.tenant.create({
    data: { name: `si-${label}-${uid}`, slug: `si-${label}-${uid}` },
  });
  createdTenantIds.add(tenant.id);
  return tenant;
};

/**
 * A stand-in for an argon2id digest.
 *
 * That exact literal rather than a fresh one because it is already carried in
 * `.gitleaks.toml`: any string sitting next to a `passwordHash` key trips the
 * generic-api-key rule, and reusing the documented placeholder keeps this file
 * from adding a second secret-scanner exemption for the same non-secret.
 */
const FAKE_HASH = 'argon2-existing';

const makeUser = async (
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> => {
  const uid = randomUUID();
  const user = await unscoped.user.create({
    data: {
      email: `si-${uid}@example.test`,
      tenantId,
      role: 'ADMIN',
      passwordHash: FAKE_HASH,
      emailVerified: true,
      ...overrides,
    },
    select: { id: true },
  });
  createdUserIds.add(user.id);
  return user;
};

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  // The extended client, exactly as PrismaService.client builds it, because
  // three of the four counts below are tenant-scoped models.
  client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;
  repository = new StaffInviteRepository({ client, unscoped } as unknown as PrismaService);
});

afterAll(async () => {
  // Users before tenants: User.tenantId is Restrict, which is the point of
  // half this file.
  if (createdUserIds.size > 0) {
    await unscoped.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
  }
  if (createdTenantIds.size > 0) {
    await unscoped.tenant.deleteMany({ where: { id: { in: [...createdTenantIds] } } });
  }
});

describe('User.tenantId is Restrict, so emptiness must count dead rows too', () => {
  it('refuses to delete an organization that still holds a SOFT-DELETED user', async () => {
    // The designed refusal depends on this. If `isAbandonable` counted only
    // live rows, a soft-deleted former colleague awaiting purge would pass the
    // check and the delete would then fail with a foreign-key error, long after
    // the invitee was told their old organization could be closed.
    const tenant = await makeTenant('restrict');
    await makeUser(tenant.id, { deletedAt: new Date(), role: 'USER' });

    await expect(unscoped.tenant.delete({ where: { id: tenant.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it('counts that soft-deleted row, so the organization reads as not abandonable', async () => {
    const tenant = await makeTenant('count');
    await makeUser(tenant.id, { deletedAt: new Date(), role: 'USER' });
    await makeUser(tenant.id, { role: 'ADMIN' });

    const count = await repository.countAllUsersInTenant(unscoped, tenant.id);

    // Two, not the one live row: exactly the number that makes the guard refuse.
    expect(count).toBe(2);
  });

  it('deletes an organization once its last row is gone', async () => {
    // The other half: the refusal above must not be a permanent one.
    const tenant = await makeTenant('deletable');
    const user = await makeUser(tenant.id);
    const other = await makeTenant('elsewhere');
    await unscoped.user.update({ where: { id: user.id }, data: { tenantId: other.id } });

    await expect(unscoped.tenant.delete({ where: { id: tenant.id } })).resolves.toMatchObject({
      id: tenant.id,
    });
    createdTenantIds.delete(tenant.id);
  });
});

describe('the emptiness counts run under the OLD tenant, or not at all', () => {
  it('fails closed when the counts are attempted with no tenant in the ALS', async () => {
    // Acceptance is unauthenticated, so there is no ambient tenant. Without the
    // explicit `requestContext.run`, `requireScope` throws rather than counting
    // every organization's rows, which is the safe direction and also a 500.
    await expect(run(undefined, async () => client.workspace.count())).rejects.toThrow();
  });

  it('counts only the named organization when the scope is set to it', async () => {
    const tenant = await makeTenant('scoped');
    const other = await makeTenant('scoped-other');
    await unscoped.workspace.create({
      data: { name: `si-workspace-${randomUUID()}`, tenantId: other.id },
    });

    const counted = await run(tenant.id, async () => client.workspace.count());

    expect(counted).toBe(0);
    await unscoped.workspace.deleteMany({ where: { tenantId: other.id } });
  });

  // NOT asserted here: that a Prisma promise merely CREATED inside
  // `requestContext.run` and awaited outside it escapes the scope. The service
  // keeps its await inside the scope on that reasoning, and the repo's own
  // notes record it, but an attempt to demonstrate it against this Postgres
  // produced a scoped answer rather than the fail-closed throw. Rather than
  // shape a test around a mechanism this file could not reproduce, the claim is
  // left to the comment at the call site, where it costs nothing to obey.
});

describe('a moved account reads the organization it joined, not the one it left', () => {
  it('sees the target organization and nothing of the previous one', async () => {
    // The eleventh tenant-isolation case, asserted immediately after a move:
    // the boundary is the ALS tenant, so an account that changed tenants has to
    // change what it can read in the same breath.
    const from = await makeTenant('from');
    const to = await makeTenant('to');
    const user = await makeUser(from.id);

    await unscoped.workspace.create({
      data: { name: `si-old-${randomUUID()}`, tenantId: from.id },
    });
    await unscoped.workspace.create({ data: { name: `si-new-${randomUUID()}`, tenantId: to.id } });

    await unscoped.$transaction(async (tx) => {
      await repository.acceptAndMove(tx, user.id, to.id, 'USER', 'argon2-new');
    });

    const moved = await unscoped.user.findUnique({
      where: { id: user.id },
      select: { tenantId: true, role: true, membershipEndedAt: true },
    });
    expect(moved).toMatchObject({ tenantId: to.id, role: 'USER', membershipEndedAt: null });

    const visible = await run(moved!.tenantId!, async () =>
      client.workspace.findMany({ select: { name: true } }),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]!.name).toContain('si-new-');

    await unscoped.workspace.deleteMany({ where: { tenantId: { in: [from.id, to.id] } } });
  });

  it('clears a removal on the way in', async () => {
    const from = await makeTenant('left');
    const to = await makeTenant('joined');
    const user = await makeUser(from.id, { membershipEndedAt: new Date() });

    await unscoped.$transaction(async (tx) => {
      await repository.acceptAndMove(tx, user.id, to.id, 'USER', 'argon2-new');
    });

    const moved = await unscoped.user.findUnique({
      where: { id: user.id },
      select: { membershipEndedAt: true },
    });
    expect(moved!.membershipEndedAt).toBeNull();
  });
});

describe('the acceptance transaction is all or nothing', () => {
  it('rolls the password and the move back together when the tenant delete fails', async () => {
    // The three writes are one act. A password set against a move that did not
    // happen would leave an account credentialed into an organization it never joined.
    const from = await makeTenant('atomic-from');
    const to = await makeTenant('atomic-to');
    const user = await makeUser(from.id);
    // A second row keeps `from` un-deletable, so the delete inside the
    // transaction fails on the Restrict foreign key.
    await makeUser(from.id, { role: 'USER' });

    await expect(
      unscoped.$transaction(async (tx) => {
        await repository.acceptAndMove(tx, user.id, to.id, 'USER', 'argon2-new');
        await repository.deleteTenant(tx, from.id);
      }),
    ).rejects.toBeDefined();

    const after = await unscoped.user.findUnique({
      where: { id: user.id },
      select: { tenantId: true, role: true, passwordHash: true },
    });
    expect(after).toMatchObject({
      tenantId: from.id,
      role: 'ADMIN',
      passwordHash: FAKE_HASH,
    });
  });
});

describe('Workspace.tenant is Cascade, which is why the transaction is Serializable', () => {
  it('would take a concurrently created workspace with the organization', async () => {
    // Stated as a property of the SCHEMA rather than of the handler, because it
    // is the schema fact that makes the isolation level load-bearing: at READ
    // COMMITTED the emptiness count can pass before a concurrent workspace commits,
    // and this delete then destroys it silently.
    const tenant = await makeTenant('cascade');
    const workspace = await unscoped.workspace.create({
      data: { name: `si-cascade-${randomUUID()}`, tenantId: tenant.id },
    });

    await unscoped.tenant.delete({ where: { id: tenant.id } });
    createdTenantIds.delete(tenant.id);

    await expect(
      unscoped.workspace.findUnique({
        where: { tenantId_id: { tenantId: tenant.id, id: workspace.id } },
      }),
    ).resolves.toBeNull();
  });

  it('refuses a Serializable transaction that lost its race, rather than writing', async () => {
    // P2034 is what the retry loop keys on. Asserting the client surfaces that
    // code, on this Postgres, at this isolation level, is the half a mocked
    // Prisma cannot answer.
    const tenant = await makeTenant('serializable');

    const bump = () =>
      unscoped.$transaction(
        async (tx) => {
          await tx.user.count({ where: { tenantId: tenant.id } });
          await tx.tenant.update({
            where: { id: tenant.id },
            data: { name: `si-race-${randomUUID()}` },
          });
        },
        { isolationLevel: 'Serializable' },
      );

    const outcomes = await Promise.allSettled([bump(), bump(), bump()]);

    // At least one has to succeed, and any failure must be the retryable code
    // rather than something the handler would surface as a 500.
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    for (const outcome of rejected) {
      expect(outcome.reason).toMatchObject({ code: 'P2034' });
    }
  });
});

describe('the invitation mail names only a live inviter', () => {
  it("returns a live colleague's display name and null for a soft-deleted one", async () => {
    // `User` is not tenant-scoped, so the extension adds nothing here: the
    // `deletedAt` predicate in the repository is the only thing standing
    // between a removed colleague's name and a fresh invitation mail.
    const tenant = await makeTenant('inviter');
    const live = await makeUser(tenant.id, { displayName: 'Jane Live' });
    const removed = await makeUser(tenant.id, {
      displayName: 'Bob Removed',
      deletedAt: new Date(),
    });

    await expect(repository.findDisplayName(live.id)).resolves.toBe('Jane Live');
    await expect(repository.findDisplayName(removed.id)).resolves.toBeNull();
  });
});
