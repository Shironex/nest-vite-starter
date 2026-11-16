/**
 * SEC-003: "open invitation" meant different things in
 * different places. `passwordHash: null` alone was read as pending, which is
 * also the shape of a Google signup, so an organization OWNER provisioned through
 * Google was listed as a pending invite and "withdraw invitation" would have
 * hard-deleted the account, every cascade included. The same misreading let
 * `countLiveAdmins` count an ADMIN who had never accepted, so the only real
 * admin could delete themselves and strand the organization.
 *
 * Fixed by defining an open invitation as the pending pair and counting admins
 * by it, guarding the revoke procedure and withdrawing cross-organization invitations
 * by address, and taking the action off the owner's row in the web UI.
 *
 * The pending pair is `passwordHash: null AND emailVerified: false`. Scope here
 * is the predicate and the destructive action it guards. The cross-organization
 * withdraw-by-address path and the members list are pinned by
 * `src/modules/auth/staff-invite/pending-invite-predicate.isolation.spec.ts` in
 * the isolation lane, referenced rather than duplicated.
 */
import { randomUUID } from 'node:crypto';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { requestContext } from '@/common/context/request-context';
import { AuditService } from '@/modules/audit/audit.service';
import { StaffInviteRepository } from '@/modules/auth/staff-invite/staff-invite.repository';
import { StaffInviteService } from '@/modules/auth/staff-invite/staff-invite.service';
import { UserRepository } from '@/modules/user/user.repository';
import { UserService } from '@/modules/user/user.service';
import { closeWorld, openWorld, type ISecurityWorld, type ISeededUser } from './fixtures';

let world: ISecurityWorld;
let users: UserRepository;
let members: UserService;
let invites: StaffInviteService;

/** An unaccepted invitation, exactly as `createPendingMember` writes one. */
const makePendingInvitee = (tenantId: string, role: 'ADMIN' | 'USER'): Promise<ISeededUser> =>
  world.makeUser(tenantId, { role, passwordHash: null, emailVerified: false });

/** A Google signup, exactly as `ProvisioningService` writes the owner. */
const makeGoogleOnly = (tenantId: string, role: 'ADMIN' | 'USER'): Promise<ISeededUser> =>
  world.makeUser(tenantId, { role, passwordHash: null, emailVerified: true });

const asActor = <T>(tenantId: string, userId: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: `sec-003-${randomUUID()}`, tenantId, userId }, fn);

const userExists = async (id: string): Promise<boolean> =>
  (await world.unscoped.user.findUnique({ where: { id }, select: { id: true } })) !== null;

const revokedAuditRows = (tenantId: string, targetId: string) =>
  world.unscoped.auditLog.findMany({
    where: { tenantId, action: AUDIT_ACTIONS.STAFF_INVITE_REVOKED, targetId },
  });

beforeAll(async () => {
  world = await openWorld('sec-003');
  const { prismaService } = world;
  users = new UserRepository(prismaService);
  // Only the repository, the audit writer and the transaction are reached by
  // the paths below; every other collaborator throws if one is touched.
  members = new UserService(
    users,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    prismaService,
    {} as never,
  );
  invites = new StaffInviteService(
    new StaffInviteRepository(prismaService),
    {} as never,
    prismaService,
    {} as never,
    members,
    {} as never,
    new AuditService(prismaService),
    { appUrl: '', enforceRateLimit: async () => undefined } as never,
    { findActiveNonRecovery: async () => null } as never,
    {} as never,
  );
});

afterAll(closeWorld);

describe('SEC-003 an open invitation is the pending pair, everywhere', () => {
  it('control: a Google-signup admin counts as an admin and is listed active', async () => {
    // `passwordHash: null` alone would drop this admin from the count and list
    // them as a pending invite, which is the whole finding.
    const tenant = await world.makeTenant('google-admin');
    const owner = await makeGoogleOnly(tenant.id, 'ADMIN');
    await world.unscoped.tenant.update({ where: { id: tenant.id }, data: { ownerId: owner.id } });
    const colleague = await world.makeUser(tenant.id, { role: 'ADMIN' });

    expect(await users.countLiveAdmins(tenant.id)).toBe(2);
    const page = await users.listUsers(tenant.id, { limit: 50 });
    const byId = new Map(page.items.map((item) => [item.id, item]));
    expect(byId.get(owner.id)).toMatchObject({ isOwner: true, status: 'active' });
    expect(byId.get(colleague.id)).toMatchObject({ status: 'active' });
  });

  it('the last-admin guard does not count a pending ADMIN invitee', async () => {
    const tenant = await world.makeTenant('stranding');
    const admin = await world.makeUser(tenant.id, { role: 'ADMIN' });
    const invitee = await makePendingInvitee(tenant.id, 'ADMIN');

    expect(await users.countLiveAdmins(tenant.id)).toBe(1);
    const page = await users.listUsers(tenant.id, { limit: 50 });
    expect(page.items.find((item) => item.id === invitee.id)).toMatchObject({ status: 'pending' });
    await expect(
      members.softDeleteSelfKeepingOneAdmin({ id: admin.id, role: 'ADMIN', tenantId: tenant.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await world.unscoped.user.findUnique({
      where: { id: admin.id },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).toBeNull();
  });

  it('revoke refuses the Google-signup owner and deletes nothing', async () => {
    const tenant = await world.makeTenant('revoke-owner');
    const owner = await makeGoogleOnly(tenant.id, 'ADMIN');
    await world.unscoped.tenant.update({ where: { id: tenant.id }, data: { ownerId: owner.id } });
    const admin = await world.makeUser(tenant.id, { role: 'ADMIN' });

    await expect(
      asActor(tenant.id, admin.id, () => invites.revoke(owner.id, admin.id, 'ip', 'ua')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await userExists(owner.id)).toBe(true);
    expect(await revokedAuditRows(tenant.id, owner.id)).toHaveLength(0);
  });

  it('control: revoke still withdraws a real pending invitation and audits it', async () => {
    const tenant = await world.makeTenant('revoke-pending');
    const admin = await world.makeUser(tenant.id, { role: 'ADMIN' });
    const invitee = await makePendingInvitee(tenant.id, 'ADMIN');

    await asActor(tenant.id, admin.id, () => invites.revoke(invitee.id, admin.id, 'ip', 'ua'));

    expect(await userExists(invitee.id)).toBe(false);
    world.forgetUser(invitee.id);
    expect(await revokedAuditRows(tenant.id, invitee.id)).toHaveLength(1);
  });
});
