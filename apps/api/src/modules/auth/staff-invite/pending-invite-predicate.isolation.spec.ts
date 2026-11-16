/**
 * Proof that "open invitation" means one thing everywhere, against the LIVE
 * docker Postgres. Excluded from the fast jest lane; runs via the integration
 * config:
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * The pending pair is `passwordHash: null AND emailVerified: false`. The unit
 * specs beside this file pin the `where` objects, which proves what was asked
 * for, not what Postgres answers: `NOT: { a: null, b: false }` is the kind of
 * clause whose SQL (a negated conjunction over a NULL) is worth seeing run. And
 * the revoke cases are hard deletes with every foreign key to User cascading,
 * so "deletes nothing" is only believable when checked against real rows.
 *
 * The populations: a real ADMIN (password), a pending ADMIN invitee, a member,
 * and a Google-signup ADMIN (no password, provider-verified), which is how a
 * organization OWNER is provisioned and the shape the old null-password test misread.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { esmImport } from '../../../common/utils/esm-import';
import { requestContext } from '../../../common/context/request-context';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import type { PrismaService } from '../../../common/database/prisma.service';
import { sha256Hex } from '../../../common/utils/crypto';
import { AuditService } from '../../audit/audit.service';
import { UserRepository } from '../../user/user.repository';
import { UserService } from '../../user/user.service';
import { StaffInviteRepository } from './staff-invite.repository';
import { StaffInviteService } from './staff-invite.service';
import { STAFF_INVITE_TOKEN_TYPE } from './staff-invite.constants';

let unscoped: PrismaClient;
let userRepository: UserRepository;
let userService: UserService;
let staffInviteService: StaffInviteService;

const createdTenantIds = new Set<string>();
const createdUserIds = new Set<string>();

/**
 * A stand-in for an argon2id digest. The literal already carried in
 * `.gitleaks.toml`, for the reason `staff-invite-acceptance.isolation.spec.ts`
 * gives: any string next to a `passwordHash` key trips the generic-api-key rule.
 */
const FAKE_HASH = 'argon2-existing';

const makeTenant = async (label: string) => {
  const uid = randomUUID();
  const tenant = await unscoped.tenant.create({
    data: { name: `pip-${label}-${uid}`, slug: `pip-${label}-${uid}` },
  });
  createdTenantIds.add(tenant.id);
  return tenant;
};

const makeUser = async (
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; email: string }> => {
  const uid = randomUUID();
  const user = await unscoped.user.create({
    data: {
      email: `pip-${uid}@example.test`,
      tenantId,
      role: 'USER',
      passwordHash: FAKE_HASH,
      emailVerified: true,
      ...overrides,
    },
    select: { id: true, email: true },
  });
  createdUserIds.add(user.id);
  return user;
};

/** An unaccepted invitation, exactly as `createPendingMember` writes one. */
const makePendingInvitee = (tenantId: string, role: 'ADMIN' | 'USER') =>
  makeUser(tenantId, { role, passwordHash: null, emailVerified: false });

/** A Google signup, exactly as `ProvisioningService` writes the owner. */
const makeGoogleOnly = (tenantId: string, role: 'ADMIN' | 'USER') =>
  makeUser(tenantId, { role, passwordHash: null, emailVerified: true });

const asActor = <T>(tenantId: string, userId: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: `pip-${randomUUID()}`, tenantId, userId }, fn);

const userExists = async (id: string): Promise<boolean> =>
  (await unscoped.user.findUnique({ where: { id }, select: { id: true } })) !== null;

const revokedAuditRows = (tenantId: string, targetId: string) =>
  unscoped.auditLog.findMany({
    where: { tenantId, action: AUDIT_ACTIONS.STAFF_INVITE_REVOKED, targetId },
  });

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  const client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;
  const prismaService = { client, unscoped } as unknown as PrismaService;

  userRepository = new UserRepository(prismaService);
  // Only the repository and the transaction are reached by the paths under
  // test; the collaborators that would be reached elsewhere throw if touched.
  userService = new UserService(
    userRepository,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    prismaService,
    {} as never,
  );
  const audit = new AuditService(prismaService);
  const stubRateLimit = { appUrl: '', enforceRateLimit: async () => undefined };
  const noFactor = { findActiveNonRecovery: async () => null };
  staffInviteService = new StaffInviteService(
    new StaffInviteRepository(prismaService),
    {} as never,
    prismaService,
    {} as never,
    userService,
    {} as never,
    audit,
    stubRateLimit as never,
    noFactor as never,
    {} as never,
  );
});

afterAll(async () => {
  // Audit rows first (no cascade from tenant), then users (User.tenantId is
  // Restrict; tokens cascade with them), then tenants.
  if (createdTenantIds.size > 0) {
    await unscoped.auditLog.deleteMany({ where: { tenantId: { in: [...createdTenantIds] } } });
    await unscoped.tenant.updateMany({
      where: { id: { in: [...createdTenantIds] } },
      data: { ownerId: null },
    });
  }
  if (createdUserIds.size > 0) {
    await unscoped.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
  }
  if (createdTenantIds.size > 0) {
    await unscoped.tenant.deleteMany({ where: { id: { in: [...createdTenantIds] } } });
  }
});

describe('the last-admin guard counts admins, not open invitations', () => {
  it("refuses the only real admin's self-deletion while an ADMIN invitation is open", async () => {
    // Counted as two before: the admin could leave, the invitee might never
    // accept, and the sweep would later erase the invitation, leaving an organization
    // with members and no way to appoint an admin.
    const tenant = await makeTenant('stranding');
    const admin = await makeUser(tenant.id, { role: 'ADMIN' });
    await makePendingInvitee(tenant.id, 'ADMIN');
    await makeUser(tenant.id, { role: 'USER' });

    expect(await userRepository.countLiveAdmins(tenant.id)).toBe(1);
    await expect(
      userService.softDeleteSelfKeepingOneAdmin({
        id: admin.id,
        role: 'ADMIN',
        tenantId: tenant.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const row = await unscoped.user.findUnique({
      where: { id: admin.id },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).toBeNull();
  });

  it('control: a Google-only ADMIN counts, so the real admin may leave', async () => {
    // `passwordHash: null` alone would have dropped this admin from the count
    // and wrongly refused the deletion below.
    const tenant = await makeTenant('google-admin');
    const admin = await makeUser(tenant.id, { role: 'ADMIN' });
    await makeGoogleOnly(tenant.id, 'ADMIN');
    await makeUser(tenant.id, { role: 'USER' });

    expect(await userRepository.countLiveAdmins(tenant.id)).toBe(2);
    await expect(
      userService.assertDeletionLeavesNobodyStranded({
        id: admin.id,
        role: 'ADMIN',
        tenantId: tenant.id,
      }),
    ).resolves.toBeUndefined();
  });

  it('counts the OTHER admins for a demotion, so re-grading an invitation is not refused', async () => {
    const tenant = await makeTenant('regrade');
    await makeUser(tenant.id, { role: 'ADMIN' });
    const invitee = await makePendingInvitee(tenant.id, 'ADMIN');

    expect(await userRepository.countLiveAdmins(tenant.id, undefined, invitee.id)).toBe(1);
  });
});

describe('the members list reads the pending pair', () => {
  it('lists a Google-signup owner as active and a real invitee as pending', async () => {
    const tenant = await makeTenant('list');
    const owner = await makeGoogleOnly(tenant.id, 'ADMIN');
    await unscoped.tenant.update({ where: { id: tenant.id }, data: { ownerId: owner.id } });
    const invitee = await makePendingInvitee(tenant.id, 'USER');

    const page = await userRepository.listUsers(tenant.id, { limit: 50 });
    const byId = new Map(page.items.map((item) => [item.id, item]));

    expect(byId.get(owner.id)).toMatchObject({ isOwner: true, status: 'active' });
    expect(byId.get(invitee.id)).toMatchObject({ isOwner: false, status: 'pending' });
  });
});

describe('staffInvite.revoke deletes open invitations and nothing else', () => {
  it('refuses a Google-only colleague and deletes nothing', async () => {
    const tenant = await makeTenant('revoke-google');
    const admin = await makeUser(tenant.id, { role: 'ADMIN' });
    const google = await makeGoogleOnly(tenant.id, 'USER');

    await expect(
      asActor(tenant.id, admin.id, () =>
        staffInviteService.revoke(google.id, admin.id, 'ip', 'ua'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await userExists(google.id)).toBe(true);
    expect(await revokedAuditRows(tenant.id, google.id)).toHaveLength(0);
  });

  it('refuses the Google-signup owner and deletes nothing', async () => {
    const tenant = await makeTenant('revoke-owner');
    const owner = await makeGoogleOnly(tenant.id, 'ADMIN');
    await unscoped.tenant.update({ where: { id: tenant.id }, data: { ownerId: owner.id } });
    const admin = await makeUser(tenant.id, { role: 'ADMIN' });

    await expect(
      asActor(tenant.id, admin.id, () => staffInviteService.revoke(owner.id, admin.id, 'ip', 'ua')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await userExists(owner.id)).toBe(true);
    expect(await revokedAuditRows(tenant.id, owner.id)).toHaveLength(0);
  });

  it("refuses the caller's own account and deletes nothing", async () => {
    const tenant = await makeTenant('revoke-self');
    const admin = await makeGoogleOnly(tenant.id, 'ADMIN');

    await expect(
      asActor(tenant.id, admin.id, () => staffInviteService.revoke(admin.id, admin.id, 'ip', 'ua')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await userExists(admin.id)).toBe(true);
  });

  it('control: withdraws a real pending invitation and audits it', async () => {
    const tenant = await makeTenant('revoke-pending');
    const admin = await makeUser(tenant.id, { role: 'ADMIN' });
    const invitee = await makePendingInvitee(tenant.id, 'ADMIN');

    await asActor(tenant.id, admin.id, () =>
      staffInviteService.revoke(invitee.id, admin.id, 'ip', 'ua'),
    );

    expect(await userExists(invitee.id)).toBe(false);
    createdUserIds.delete(invitee.id);
    expect(await revokedAuditRows(tenant.id, invitee.id)).toHaveLength(1);
  });
});

describe('staffInvite.withdrawByEmail withdraws a cross-organization invitation', () => {
  /** A collision-path token, exactly as `mintFreshToken` writes one. */
  const mintForeignInvite = async (userId: string, targetTenantId: string): Promise<string> => {
    const raw = randomBytes(32).toString('hex');
    await unscoped.token.create({
      data: {
        userId,
        type: STAFF_INVITE_TOKEN_TYPE,
        token: sha256Hex(raw),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        staffInviteTenantId: targetTenantId,
        staffInviteRole: 'ADMIN',
      },
    });
    return raw;
  };

  it('deletes the token, which the state check and acceptance then reject, and leaves the account alone', async () => {
    const inviting = await makeTenant('inviting');
    const admin = await makeUser(inviting.id, { role: 'ADMIN' });
    const home = await makeTenant('home');
    const elsewhere = await makeUser(home.id, { role: 'ADMIN' });
    const raw = await mintForeignInvite(elsewhere.id, inviting.id);
    const before = await unscoped.user.findUnique({ where: { id: elsewhere.id } });

    expect((await staffInviteService.getInviteState(raw, 'ip')).valid).toBe(true);

    await asActor(inviting.id, admin.id, () =>
      staffInviteService.withdrawByEmail(elsewhere.email.toUpperCase(), 'ip', 'ua'),
    );

    expect(await staffInviteService.getInviteState(raw, 'ip')).toMatchObject({ valid: false });
    await expect(
      staffInviteService.accept(raw, 'a-new-password-123', undefined, 'ip', 'ua'),
    ).rejects.toMatchObject({ appCode: 'INVALID_TOKEN' });
    // The account in the other organization is exactly as it was.
    expect(await unscoped.user.findUnique({ where: { id: elsewhere.id } })).toEqual(before);
    expect(await revokedAuditRows(inviting.id, elsewhere.id)).toHaveLength(1);
  });

  it('cannot withdraw an invitation another organization sent to the same person', async () => {
    const inviting = await makeTenant('mine');
    const admin = await makeUser(inviting.id, { role: 'ADMIN' });
    const other = await makeTenant('theirs');
    const home = await makeTenant('home2');
    const person = await makeUser(home.id, { role: 'ADMIN' });
    const raw = await mintForeignInvite(person.id, other.id);

    await asActor(inviting.id, admin.id, () =>
      staffInviteService.withdrawByEmail(person.email, 'ip', 'ua'),
    );

    expect((await staffInviteService.getInviteState(raw, 'ip')).valid).toBe(true);
    expect(await revokedAuditRows(inviting.id, person.id)).toHaveLength(0);
  });

  it('answers the same for an address with nothing open, and writes no audit row', async () => {
    const inviting = await makeTenant('nothing');
    const admin = await makeUser(inviting.id, { role: 'ADMIN' });

    await expect(
      asActor(inviting.id, admin.id, () =>
        staffInviteService.withdrawByEmail(`nobody-${randomUUID()}@example.test`, 'ip', 'ua'),
      ),
    ).resolves.toBeUndefined();
    const rows = await unscoped.auditLog.findMany({
      where: { tenantId: inviting.id, action: AUDIT_ACTIONS.STAFF_INVITE_REVOKED },
    });
    expect(rows).toHaveLength(0);
  });
});
