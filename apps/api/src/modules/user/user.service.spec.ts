import { Test } from '@nestjs/testing';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { StorageService } from '../storage/storage.service';
import { SessionRevocationService } from '../events/session-revocation.service';
import { AuditService } from '../audit/audit.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { requestContext } from '../../common/context/request-context';
import { storageOrphanCleanupFailuresTotal } from '../metrics/metrics.registry';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { PrismaService } from '../../common/database/prisma.service';
import { RedisKeys } from '../../common/redis/redis-keys';
import { userFixture, userProfileFixture } from '@test/fixtures';

const TENANT_A = 'tenant-a';

/** Run `fn` inside an ALS store carrying the given active tenant. */
const withTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: 't', tenantId }, fn);

const buildSubject = async () => {
  const repo = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findCredentialById: jest.fn(),
    findCredentialByEmail: jest.fn(),
    getProfile: jest.fn(),
    listUsers: jest.fn(),
    verifyEmail: jest.fn(),
    updateAvatar: jest.fn(),
    updateAvatarIfCurrent: jest.fn(),
    updatePassword: jest.fn(),
    updateRoleScoped: jest.fn().mockResolvedValue(1),
    softDelete: jest.fn(),
    findRoleScoped: jest.fn(),
    softDeleteScopedNonAdmin: jest.fn(),
    lockTenantMembership: jest.fn().mockResolvedValue(undefined),
    // Two by default: the ordinary organization where a demotion is allowed. Tests
    // that care about the guard set it to 1 explicitly.
    countLiveAdmins: jest.fn().mockResolvedValue(2),
    // No owner by default, so the owner rule does not apply and the existing
    // cases keep testing what they were written to test. Cases that care set it.
    findOwnerId: jest.fn().mockResolvedValue(null),
    getTenantName: jest.fn().mockResolvedValue(null),
    countOtherLiveMembers: jest.fn().mockResolvedValue(0),
    // An ordinary active USER colleague: the target every removal case varies.
    findMemberScoped: jest
      .fn()
      .mockResolvedValue({ id: 'u-2', role: 'USER', passwordHash: 'h', membershipEndedAt: null }),
    endMembership: jest.fn().mockResolvedValue(1),
    restoreMembership: jest.fn().mockResolvedValue(1),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const sessionRevocation = { revokeAllAndDisconnect: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notificationEvents = {
    adminRoleChanged: jest.fn().mockResolvedValue(undefined),
    adminUserDeleted: jest.fn().mockResolvedValue(undefined),
  };
  const redis = { del: jest.fn().mockResolvedValue(1) };
  // The demotion guard runs its count and its write on one transaction; the
  // callback is invoked with the same mocked repo, so assertions are unchanged.
  const prisma = { client: { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) } };
  const module = await Test.createTestingModule({
    providers: [
      UserService,
      { provide: UserRepository, useValue: repo },
      { provide: StorageService, useValue: storage },
      { provide: SessionRevocationService, useValue: sessionRevocation },
      { provide: AuditService, useValue: audit },
      { provide: NotificationEventsService, useValue: notificationEvents },
      { provide: PrismaService, useValue: prisma },
      { provide: REDIS_CLIENT, useValue: redis },
    ],
  }).compile();
  return {
    service: module.get(UserService),
    repo,
    storage,
    sessionRevocation,
    audit,
    notificationEvents,
    redis,
    prisma,
  };
};

describe('UserService', () => {
  describe('normalizeEmail', () => {
    it.each([
      ['  Foo@BAR.com  ', 'foo@bar.com'],
      ['', ''],
      ['already@lc.com', 'already@lc.com'],
      ['MIXED@CASE.COM', 'mixed@case.com'],
    ])('normalizes %p → %p', async (input, expected) => {
      const { service } = await buildSubject();
      expect(service.normalizeEmail(input)).toBe(expected);
    });
  });

  describe('findByEmail', () => {
    it('normalizes the email before delegating to the repository', async () => {
      const { service, repo } = await buildSubject();
      repo.findByEmail.mockResolvedValue(userFixture());
      await service.findByEmail('  USER@EXAMPLE.COM  ');
      expect(repo.findByEmail).toHaveBeenCalledWith('user@example.com');
    });
  });

  describe('credential finders', () => {
    it('findCredentialByEmail normalizes then delegates to the credential repo finder', async () => {
      const { service, repo } = await buildSubject();
      repo.findCredentialByEmail.mockResolvedValue(userFixture());
      await service.findCredentialByEmail('  USER@EXAMPLE.COM  ');
      expect(repo.findCredentialByEmail).toHaveBeenCalledWith('user@example.com');
      // The default (credential-free) finder must NOT be used by the login path.
      expect(repo.findByEmail).not.toHaveBeenCalled();
    });

    it('findCredentialById delegates straight to the credential repo finder', async () => {
      const { service, repo } = await buildSubject();
      repo.findCredentialById.mockResolvedValue(userFixture());
      await service.findCredentialById('u-1');
      expect(repo.findCredentialById).toHaveBeenCalledWith('u-1');
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('returns the profile when the repository finds the user', async () => {
      const { service, repo } = await buildSubject();
      const profile = userProfileFixture();
      repo.getProfile.mockResolvedValue(profile);
      await expect(service.getProfile('u-1')).resolves.toEqual(profile);
    });

    it('throws NOT_FOUND when the repository returns null', async () => {
      const { service, repo } = await buildSubject();
      repo.getProfile.mockResolvedValue(null);
      await expect(service.getProfile('ghost')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
    });
  });

  describe('getTenantIdentity', () => {
    it('returns { name: null } and never queries when there is no tenant in context', async () => {
      const { service, repo } = await buildSubject();
      // Called OUTSIDE requestContext.run: no active tenant. Unlike the
      // admin-scoped methods this must not throw: it backs a chrome read, and
      // the caller renders a fallback rather than an error boundary.
      await expect(service.getTenantIdentity()).resolves.toEqual({ name: null });
      expect(repo.getTenantName).not.toHaveBeenCalled();
    });

    it('resolves the organization name from the active tenant', async () => {
      const { service, repo } = await buildSubject();
      repo.getTenantName.mockResolvedValue('Acme Robotics');

      const identity = await withTenant(TENANT_A, () => service.getTenantIdentity());

      expect(repo.getTenantName).toHaveBeenCalledWith(TENANT_A);
      expect(identity).toEqual({ name: 'Acme Robotics' });
    });

    it('returns { name: null } when the tenant row itself is gone', async () => {
      const { service, repo } = await buildSubject();
      repo.getTenantName.mockResolvedValue(null);

      const identity = await withTenant(TENANT_A, () => service.getTenantIdentity());

      expect(identity).toEqual({ name: null });
    });
  });

  describe('thin delegations', () => {
    it('updatePassword → repo.updatePassword (forwards the optional tx client)', async () => {
      const { service, repo } = await buildSubject();
      repo.updatePassword.mockResolvedValue(1);
      await service.updatePassword('u-1', 'h');
      expect(repo.updatePassword).toHaveBeenCalledWith('u-1', 'h', undefined);

      const tx = { user: { updateMany: jest.fn() } };
      await service.updatePassword('u-1', 'h', tx as never);
      expect(repo.updatePassword).toHaveBeenCalledWith('u-1', 'h', tx);
    });

    it('updatePassword throws NOT_FOUND when the guarded write matches zero rows', async () => {
      const { service, repo } = await buildSubject();
      repo.updatePassword.mockResolvedValue(0);
      await expect(service.updatePassword('ghost', 'h')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
    });

    it('verifyEmail → repo.verifyEmail (forwards the optional tx client)', async () => {
      const { service, repo } = await buildSubject();
      repo.verifyEmail.mockResolvedValue(1);
      await service.verifyEmail('u-1');
      expect(repo.verifyEmail).toHaveBeenCalledWith('u-1', undefined);

      const tx = { user: { updateMany: jest.fn() } };
      await service.verifyEmail('u-1', tx as never);
      expect(repo.verifyEmail).toHaveBeenCalledWith('u-1', tx);
    });

    it('verifyEmail throws NOT_FOUND when the guarded write matches zero rows', async () => {
      const { service, repo } = await buildSubject();
      repo.verifyEmail.mockResolvedValue(0);
      await expect(service.verifyEmail('ghost')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
    });

    it('updateAvatar swaps against the current key (accepts null)', async () => {
      const { service, repo } = await buildSubject();
      repo.getProfile.mockResolvedValue(userProfileFixture({ avatarUrl: null }));
      repo.updateAvatarIfCurrent.mockResolvedValue(true);
      await service.updateAvatar('u-1', null);
      expect(repo.updateAvatarIfCurrent).toHaveBeenCalledWith('u-1', null, null);
    });

    it('updateAvatar throws NOT_FOUND when the user is missing or soft-deleted', async () => {
      const { service, repo, storage } = await buildSubject();
      repo.getProfile.mockResolvedValue(null);
      await expect(service.updateAvatar('ghost', null)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
      expect(repo.updateAvatarIfCurrent).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('updateAvatar deletes the previous stored object when the swap succeeded', async () => {
      const { service, repo, storage } = await buildSubject();
      repo.getProfile.mockResolvedValue(userProfileFixture({ avatarUrl: 'avatars/u-1/old.png' }));
      repo.updateAvatarIfCurrent.mockResolvedValue(true);
      await service.updateAvatar('u-1', 'avatars/u-1/new.png');
      expect(repo.updateAvatarIfCurrent).toHaveBeenCalledWith(
        'u-1',
        'avatars/u-1/new.png',
        'avatars/u-1/old.png',
      );
      expect(storage.delete).toHaveBeenCalledWith('avatars/u-1/old.png');
    });

    it('updateAvatar does NOT delete external http(s) avatar URLs', async () => {
      const { service, repo, storage } = await buildSubject();
      repo.getProfile.mockResolvedValue(
        userProfileFixture({ avatarUrl: 'https://example.com/me.png' }),
      );
      repo.updateAvatarIfCurrent.mockResolvedValue(true);
      await service.updateAvatar('u-1', 'avatars/u-1/new.png');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('updateAvatar still resolves when deleting the old object fails, counting the orphan', async () => {
      const { service, repo, storage } = await buildSubject();
      const incSpy = jest.spyOn(storageOrphanCleanupFailuresTotal, 'inc');
      repo.getProfile.mockResolvedValue(userProfileFixture({ avatarUrl: 'avatars/u-1/old.png' }));
      repo.updateAvatarIfCurrent.mockResolvedValue(true);
      storage.delete.mockRejectedValue(new Error('S3 down'));
      await expect(service.updateAvatar('u-1', 'avatars/u-1/new.png')).resolves.toBeUndefined();
      // The failed best-effort cleanup orphans the old object: it must be
      // counted, not just warn-logged.
      expect(incSpy).toHaveBeenCalledTimes(1);
      incSpy.mockRestore();
    });

    it('updateAvatar retries the swap once against the re-read key after losing a race, then deletes the key it owns', async () => {
      const { service, repo, storage } = await buildSubject();
      // A concurrent update moved the avatar from old.png to mid.png between
      // this caller's read and its swap.
      repo.getProfile
        .mockResolvedValueOnce(userProfileFixture({ avatarUrl: 'avatars/u-1/old.png' }))
        .mockResolvedValueOnce(userProfileFixture({ avatarUrl: 'avatars/u-1/mid.png' }));
      repo.updateAvatarIfCurrent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await service.updateAvatar('u-1', 'avatars/u-1/new.png');

      expect(repo.updateAvatarIfCurrent).toHaveBeenNthCalledWith(
        1,
        'u-1',
        'avatars/u-1/new.png',
        'avatars/u-1/old.png',
      );
      expect(repo.updateAvatarIfCurrent).toHaveBeenNthCalledWith(
        2,
        'u-1',
        'avatars/u-1/new.png',
        'avatars/u-1/mid.png',
      );
      // Only the key this caller actually swapped out may be deleted; the
      // stale old.png now belongs to whoever replaced it.
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith('avatars/u-1/mid.png');
    });

    it('updateAvatar throws NOT_FOUND when the user vanishes between the failed swap and the re-read', async () => {
      const { service, repo, storage } = await buildSubject();
      repo.getProfile
        .mockResolvedValueOnce(userProfileFixture({ avatarUrl: 'avatars/u-1/old.png' }))
        .mockResolvedValueOnce(null);
      repo.updateAvatarIfCurrent.mockResolvedValue(false);

      await expect(service.updateAvatar('u-1', 'avatars/u-1/new.png')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('updateAvatar lands the write but skips deletion when both swaps lose the race', async () => {
      const { service, repo, storage } = await buildSubject();
      repo.getProfile
        .mockResolvedValueOnce(userProfileFixture({ avatarUrl: 'avatars/u-1/old.png' }))
        .mockResolvedValueOnce(userProfileFixture({ avatarUrl: 'avatars/u-1/mid.png' }));
      repo.updateAvatarIfCurrent.mockResolvedValue(false);
      repo.updateAvatar.mockResolvedValue(1);

      await expect(service.updateAvatar('u-1', 'avatars/u-1/new.png')).resolves.toBeUndefined();

      // The fallback write is unconditional on the key (still soft-delete
      // guarded), and no deletion happens: ownership was never proven.
      expect(repo.updateAvatar).toHaveBeenCalledWith('u-1', 'avatars/u-1/new.png');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('updateAvatar throws NOT_FOUND when the fallback guarded write matches zero rows', async () => {
      const { service, repo, storage } = await buildSubject();
      repo.getProfile.mockResolvedValue(userProfileFixture({ avatarUrl: 'avatars/u-1/old.png' }));
      repo.updateAvatarIfCurrent.mockResolvedValue(false);
      repo.updateAvatar.mockResolvedValue(0);

      await expect(service.updateAvatar('u-1', 'avatars/u-1/new.png')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('listUsers → repo.listUsers, scoped to the caller tenant with the pagination params', async () => {
      const { service, repo } = await buildSubject();
      const page = { items: [], nextCursor: null };
      repo.listUsers.mockResolvedValue(page);
      await expect(withTenant(TENANT_A, () => service.listUsers({ limit: 50 }))).resolves.toEqual(
        page,
      );
      expect(repo.listUsers).toHaveBeenCalledWith(TENANT_A, { limit: 50 });
    });

    it('listUsers forwards an explicit cursor', async () => {
      const { service, repo } = await buildSubject();
      repo.listUsers.mockResolvedValue({ items: [], nextCursor: null });
      await withTenant(TENANT_A, () => service.listUsers({ cursor: 'u-9', limit: 10 }));
      expect(repo.listUsers).toHaveBeenCalledWith(TENANT_A, { cursor: 'u-9', limit: 10 });
    });

    it('listUsers surfaces the repository-derived twoFactorEnabled flag per row', async () => {
      const { service, repo } = await buildSubject();
      const listItem = (id: string, twoFactorEnabled: boolean) => ({
        id,
        email: `${id}@example.com`,
        displayName: null,
        role: 'USER',
        emailVerified: true,
        lockedUntil: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        twoFactorEnabled,
      });
      const page = { items: [listItem('u-1', true), listItem('u-2', false)], nextCursor: null };
      repo.listUsers.mockResolvedValue(page);

      const result = await withTenant(TENANT_A, () => service.listUsers({ limit: 50 }));

      expect(result.items.map((u) => ({ id: u.id, twoFactorEnabled: u.twoFactorEnabled }))).toEqual(
        [
          { id: 'u-1', twoFactorEnabled: true },
          { id: 'u-2', twoFactorEnabled: false },
        ],
      );
    });
  });

  describe('listUsers tenant containment', () => {
    it('throws FORBIDDEN and never queries when there is no tenant in context', async () => {
      const { service, repo } = await buildSubject();
      // Called OUTSIDE requestContext.run: no active tenant -> fail closed.
      await expect(service.listUsers({ limit: 50 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: AppErrorCode.FORBIDDEN,
      });
      expect(repo.listUsers).not.toHaveBeenCalled();
    });
  });

  describe('assertDeletionLeavesNobodyStranded', () => {
    /**
     * deleteAccount soft-deletes whatever role it is given, so the last ADMIN
     * of an organization could erase themselves and leave everyone else with no admin,
     * no owner, and no in-app way to appoint one. That is the same permanent
     * lockout updateRole guards against, through a door updateRole cannot see.
     */
    it('refuses when the last admin would strand colleagues', async () => {
      const { service, repo } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(1);
      repo.countOtherLiveMembers.mockResolvedValue(2);

      await expect(
        service.assertDeletionLeavesNobodyStranded({
          id: 'u-1',
          role: 'ADMIN',
          tenantId: TENANT_A,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    /**
     * The only case that exists today, and it strands nobody. Self-service
     * deletion has to keep working for it.
     */
    it('allows a sole user to delete their own account', async () => {
      const { service, repo } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(1);
      repo.countOtherLiveMembers.mockResolvedValue(0);

      await expect(
        service.assertDeletionLeavesNobodyStranded({
          id: 'u-1',
          role: 'ADMIN',
          tenantId: TENANT_A,
        }),
      ).resolves.toBeUndefined();
    });

    it('allows an admin to leave when another admin remains', async () => {
      const { service, repo } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(2);

      await expect(
        service.assertDeletionLeavesNobodyStranded({
          id: 'u-1',
          role: 'ADMIN',
          tenantId: TENANT_A,
        }),
      ).resolves.toBeUndefined();
      expect(repo.countOtherLiveMembers).not.toHaveBeenCalled();
    });

    it('does not count anything for a non-admin or a user with no organization', async () => {
      const { service, repo } = await buildSubject();

      await service.assertDeletionLeavesNobodyStranded({
        id: 'u-1',
        role: 'USER',
        tenantId: TENANT_A,
      });
      await service.assertDeletionLeavesNobodyStranded({
        id: 'u-2',
        role: 'ADMIN',
        tenantId: null,
      });

      expect(repo.countLiveAdmins).not.toHaveBeenCalled();
    });
  });

  describe('softDeleteSelfKeepingOneAdmin', () => {
    /**
     * The guard is a count and the deletion is a write, and between them two
     * admins pressing "delete my account" in the same second both read two live
     * admins and both commit. The organization is then left with zero admins and
     * stranded members, which is the state the guard exists to prevent and
     * which has no in-app remedy.
     */
    it('takes the tenant membership lock before counting, on the same transaction', async () => {
      const { service, repo, prisma } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(2);
      repo.softDelete.mockResolvedValue(1);

      await service.softDeleteSelfKeepingOneAdmin({
        id: 'u-1',
        role: 'ADMIN',
        tenantId: TENANT_A,
      });

      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(repo.lockTenantMembership).toHaveBeenCalledWith(TENANT_A, {});
      expect(repo.lockTenantMembership.mock.invocationCallOrder[0]!).toBeLessThan(
        repo.countLiveAdmins.mock.invocationCallOrder[0]!,
      );
      expect(repo.softDelete).toHaveBeenCalledWith('u-1', {});
    });

    it('refuses inside the lock when the deletion would strand colleagues', async () => {
      const { service, repo } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(1);
      repo.countOtherLiveMembers.mockResolvedValue(2);

      await expect(
        service.softDeleteSelfKeepingOneAdmin({ id: 'u-1', role: 'ADMIN', tenantId: TENANT_A }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    /**
     * A non-admin cannot strand anyone, so serializing them would put every
     * deletion in the deployment behind a per-tenant lock for nothing.
     */
    it.each([
      ['a non-admin', { id: 'u-1', role: 'USER', tenantId: TENANT_A }],
      ['an account with no organization', { id: 'u-2', role: 'ADMIN', tenantId: null }],
    ])('deletes %s without taking the lock', async (_label, user) => {
      const { service, repo, prisma } = await buildSubject();
      repo.softDelete.mockResolvedValue(1);

      await expect(service.softDeleteSelfKeepingOneAdmin(user)).resolves.toBe(1);

      expect(prisma.client.$transaction).not.toHaveBeenCalled();
      expect(repo.lockTenantMembership).not.toHaveBeenCalled();
      expect(repo.softDelete).toHaveBeenCalledWith(user.id);
    });

    /** A concurrent double-delete already achieved what the caller asked for. */
    it('reports zero rows rather than throwing', async () => {
      const { service, repo } = await buildSubject();
      repo.softDelete.mockResolvedValue(0);

      await expect(
        service.softDeleteSelfKeepingOneAdmin({ id: 'u-1', role: 'USER', tenantId: TENANT_A }),
      ).resolves.toBe(0);
    });
  });

  describe('updateRole', () => {
    /** The pre-change row the audit `before` is taken from. */
    const existingStaffUser = (repo: { findRoleScoped: jest.Mock }, role = 'USER') =>
      repo.findRoleScoped.mockResolvedValue({ id: 'u-1', role, email: 'target@example.com' });

    it('updates the role (scoped to caller tenant), revokes sessions + live sockets, then clears every role-keyed permission entry', async () => {
      const { service, repo, sessionRevocation, redis } = await buildSubject();
      existingStaffUser(repo);
      repo.updateRoleScoped.mockResolvedValue(1);

      await withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'ADMIN'));

      expect(repo.updateRoleScoped).toHaveBeenCalledWith('u-1', TENANT_A, 'ADMIN');
      // The shared revocation step deletes the Redis sessions AND disconnects
      // the user's websockets (which keep the old-role identity until
      // reconnect).
      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-1');
      // The cache is keyed by userId:role, so clear EVERY role variant - no
      // stale role's permission list may survive the change.
      // Every role a User row can hold (ALL_ROLES): PermissionMiddleware caches
      // under whatever role string the session carries.
      expect(redis.del).toHaveBeenCalledWith(
        RedisKeys.permissions('u-1', 'USER'),
        RedisKeys.permissions('u-1', 'ADMIN'),
      );
      // Order matters and is the inverse of the obvious one: revoke sessions
      // BEFORE clearing the cache so an old-role session cannot rebuild
      // (repoison) the entry in the gap. The DB write lands first of all.
      expect(repo.updateRoleScoped.mock.invocationCallOrder[0]!).toBeLessThan(
        sessionRevocation.revokeAllAndDisconnect.mock.invocationCallOrder[0]!,
      );
      expect(sessionRevocation.revokeAllAndDisconnect.mock.invocationCallOrder[0]!).toBeLessThan(
        redis.del.mock.invocationCallOrder[0]!,
      );
    });

    it('broadcasts the role change to the other admins (preference-gated inside)', async () => {
      const { service, repo, notificationEvents } = await buildSubject();
      existingStaffUser(repo);
      repo.updateRoleScoped.mockResolvedValue(1);

      await withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'ADMIN'));

      expect(notificationEvents.adminRoleChanged).toHaveBeenCalledWith({
        targetEmail: 'target@example.com',
        role: 'ADMIN',
      });
      // The address comes from the pre-change probe, so the broadcast costs no
      // second read of the same row.
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('audits the change with the old and new role, before the teardown', async () => {
      const { service, repo, audit, sessionRevocation } = await buildSubject();
      existingStaffUser(repo, 'USER');
      repo.updateRoleScoped.mockResolvedValue(1);

      await withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'ADMIN'));

      expect(audit.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
        targetType: 'User',
        targetId: 'u-1',
        before: { role: 'USER' },
        after: { role: 'ADMIN' },
      });
      // The DB row has already moved by then, so writing the row BEFORE the
      // revoke is what keeps a Redis outage from costing the trail entirely.
      expect(audit.log.mock.invocationCallOrder[0]!).toBeLessThan(
        sessionRevocation.revokeAllAndDisconnect.mock.invocationCallOrder[0]!,
      );
      // ...and after the write it describes.
      expect(repo.updateRoleScoped.mock.invocationCallOrder[0]!).toBeLessThan(
        audit.log.mock.invocationCallOrder[0]!,
      );
    });

    it('does not revoke sessions or sockets when the role update throws', async () => {
      const { service, repo, sessionRevocation } = await buildSubject();
      existingStaffUser(repo);
      repo.updateRoleScoped.mockRejectedValue(new Error('DB down'));

      await expect(
        withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'USER')),
      ).rejects.toThrow('DB down');
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    /**
     * The procedure is admin-gated, so the caller is already an ADMIN and self
     * PROMOTION is meaningless. What is left is self-demotion, and it is how a
     * organization loses its last admin: promotion requires an admin, so once the only
     * one demotes themselves nobody remains who can put it back. There is no
     * in-app recovery from that state.
     *
     * Refused before the tenant probe, because the answer does not depend on
     * the tenant.
     */
    it("refuses to change the caller's own role, before it even reads the tenant", async () => {
      const { service, repo, sessionRevocation, audit } = await buildSubject();

      await expect(
        withTenant(TENANT_A, () => service.updateRole('u-1', 'u-1', 'USER')),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: AppErrorCode.FORBIDDEN });
      expect(repo.findRoleScoped).not.toHaveBeenCalled();
      expect(repo.updateRoleScoped).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    /**
     * An organization with no admin cannot create workspaces, manage members
     * or read its own audit log. Promotion requires an admin, so there is no
     * in-app way back from that state.
     */
    it('refuses to demote the last admin, and writes nothing', async () => {
      const { service, repo, audit, sessionRevocation } = await buildSubject();
      existingStaffUser(repo, 'ADMIN');
      // Zero OTHER live admins: the target is the last one.
      repo.countLiveAdmins.mockResolvedValue(0);

      await expect(
        withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'USER')),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(repo.updateRoleScoped).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    it('demotes an admin while the organization still has another one', async () => {
      const { service, repo } = await buildSubject();
      existingStaffUser(repo, 'ADMIN');
      repo.countLiveAdmins.mockResolvedValue(1);

      await withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'USER'));

      expect(repo.updateRoleScoped).toHaveBeenCalledWith('u-1', TENANT_A, 'USER', {});
    });

    /** Asking for the OTHER admins answers the question the guard means. */
    it('counts the admins OTHER than the target', async () => {
      const { service, repo } = await buildSubject();
      existingStaffUser(repo, 'ADMIN');
      repo.countLiveAdmins.mockResolvedValue(1);

      await withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'USER'));

      expect(repo.countLiveAdmins).toHaveBeenCalledWith(TENANT_A, {}, 'u-1');
    });

    /**
     * The lock is the guard. Without it two admins demoting each other
     * concurrently both read a count of two, both writes land, and the organization is
     * left with none, which is the exact state the count exists to prevent. It
     * has to be taken BEFORE the count, because a lock acquired afterwards
     * protects nothing: the stale number is already in hand.
     */
    it('takes the tenant membership lock before counting, on the same transaction', async () => {
      const { service, repo, prisma } = await buildSubject();
      existingStaffUser(repo, 'ADMIN');

      await withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'USER'));

      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(repo.lockTenantMembership).toHaveBeenCalledWith(TENANT_A, {});
      const lockOrder = repo.lockTenantMembership.mock.invocationCallOrder[0]!;
      const countOrder = repo.countLiveAdmins.mock.invocationCallOrder[0]!;
      expect(lockOrder).toBeLessThan(countOrder);
    });

    /** A promotion cannot empty the admin set, so it never pays for the lock. */
    it('promotes without taking the lock or counting admins', async () => {
      const { service, repo, prisma } = await buildSubject();
      existingStaffUser(repo, 'USER');

      await withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'ADMIN'));

      expect(prisma.client.$transaction).not.toHaveBeenCalled();
      expect(repo.lockTenantMembership).not.toHaveBeenCalled();
      expect(repo.countLiveAdmins).not.toHaveBeenCalled();
      expect(repo.updateRoleScoped).toHaveBeenCalledWith('u-1', TENANT_A, 'ADMIN');
    });

    /**
     * The founder takeover, closed at its first step. A promoted ADMIN could
     * otherwise demote the owner and then delete them, two calls that each pass
     * every other check in the system.
     */
    it('refuses to let another admin demote the organization owner', async () => {
      const { service, repo, audit } = await buildSubject();
      existingStaffUser(repo, 'ADMIN');
      repo.findOwnerId.mockResolvedValue('u-1');

      await expect(
        withTenant(TENANT_A, () => service.updateRole('other-admin', 'u-1', 'USER')),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(repo.updateRoleScoped).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    /**
     * A null owner is a permanent population, not an error: nothing deletes an
     * orphan Tenant, so an organization whose only ADMIN self-deleted keeps its row with
     * nobody to name. The rule does not apply rather than failing closed.
     */
    it('applies no owner rule when the organization has no owner', async () => {
      const { service, repo } = await buildSubject();
      existingStaffUser(repo, 'ADMIN');
      repo.findOwnerId.mockResolvedValue(null);

      await withTenant(TENANT_A, () => service.updateRole('other-admin', 'u-1', 'USER'));

      expect(repo.updateRoleScoped).toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a cross-tenant target and never writes, revokes or audits', async () => {
      const { service, repo, sessionRevocation, redis, audit } = await buildSubject();
      // Target lives in another organization: the scoped probe matches zero rows, so
      // the write is never attempted.
      repo.findRoleScoped.mockResolvedValue(null);

      await expect(
        withTenant(TENANT_A, () => service.updateRole('actor-1', 'other-tenant-user', 'ADMIN')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: AppErrorCode.NOT_FOUND });
      expect(repo.findRoleScoped).toHaveBeenCalledWith('other-tenant-user', TENANT_A);
      expect(repo.updateRoleScoped).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND and does not audit when the row moves between probe and write', async () => {
      const { service, repo, sessionRevocation, audit } = await buildSubject();
      existingStaffUser(repo);
      // Deleted or re-tenanted in the gap: nothing changed, so nothing to log.
      repo.updateRoleScoped.mockResolvedValue(0);

      await expect(
        withTenant(TENANT_A, () => service.updateRole('actor-1', 'u-1', 'ADMIN')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: AppErrorCode.NOT_FOUND });
      expect(audit.log).not.toHaveBeenCalled();
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN and never writes when there is no tenant in context', async () => {
      const { service, repo, sessionRevocation } = await buildSubject();
      // Called OUTSIDE requestContext.run: no active tenant -> fail closed.
      await expect(service.updateRole('actor-1', 'u-1', 'ADMIN')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: AppErrorCode.FORBIDDEN,
      });
      expect(repo.findRoleScoped).not.toHaveBeenCalled();
      expect(repo.updateRoleScoped).not.toHaveBeenCalled();
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });
  });

  describe('softDeleteById', () => {
    it('delegates to repo.softDelete and returns the count without throwing on zero rows', async () => {
      const { service, repo } = await buildSubject();
      repo.softDelete.mockResolvedValue(0);
      // Zero rows is the caller's signal (idempotent double-delete), not an error.
      await expect(service.softDeleteById('u-1')).resolves.toBe(0);
      expect(repo.softDelete).toHaveBeenCalledWith('u-1');
    });
  });

  describe('adminDeleteUser', () => {
    const target = { id: 'target-1', role: 'USER', email: 'target@example.com' };

    it('soft-deletes the tenant-scoped target, revokes sessions + sockets + permission cache, then audits', async () => {
      const { service, repo, sessionRevocation, audit, redis } = await buildSubject();
      repo.findRoleScoped.mockResolvedValue(target);
      repo.softDeleteScopedNonAdmin.mockResolvedValue(1);

      await withTenant(TENANT_A, () => service.adminDeleteUser('target-1', 'admin-1'));

      expect(repo.findRoleScoped).toHaveBeenCalledWith('target-1', TENANT_A);
      expect(repo.softDeleteScopedNonAdmin).toHaveBeenCalledWith('target-1', TENANT_A);
      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('target-1');
      expect(redis.del).toHaveBeenCalledWith(
        RedisKeys.permissions('target-1', 'USER'),
        RedisKeys.permissions('target-1', 'ADMIN'),
      );
      expect(audit.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.USER_ACCOUNT_ADMIN_DELETED,
        targetType: 'User',
        targetId: 'target-1',
      });
      // DB write first, then revoke, then cache clear (same contract as updateRole).
      expect(repo.softDeleteScopedNonAdmin.mock.invocationCallOrder[0]!).toBeLessThan(
        sessionRevocation.revokeAllAndDisconnect.mock.invocationCallOrder[0]!,
      );
      expect(sessionRevocation.revokeAllAndDisconnect.mock.invocationCallOrder[0]!).toBeLessThan(
        redis.del.mock.invocationCallOrder[0]!,
      );
    });

    it('broadcasts the deletion to the other admins using the pre-delete email', async () => {
      const { service, repo, notificationEvents } = await buildSubject();
      repo.findRoleScoped.mockResolvedValue(target);
      repo.softDeleteScopedNonAdmin.mockResolvedValue(1);

      await withTenant(TENANT_A, () => service.adminDeleteUser('target-1', 'admin-1'));

      expect(notificationEvents.adminUserDeleted).toHaveBeenCalledWith({
        targetEmail: 'target@example.com',
      });
    });

    it('throws FORBIDDEN and never reads or writes when there is no tenant in context', async () => {
      const { service, repo, sessionRevocation, audit } = await buildSubject();
      await expect(service.adminDeleteUser('target-1', 'admin-1')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: AppErrorCode.FORBIDDEN,
      });
      expect(repo.findRoleScoped).not.toHaveBeenCalled();
      expect(repo.softDeleteScopedNonAdmin).not.toHaveBeenCalled();
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN for a self-delete through the admin path (self-service owns that)', async () => {
      const { service, repo } = await buildSubject();
      await expect(
        withTenant(TENANT_A, () => service.adminDeleteUser('admin-1', 'admin-1')),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: AppErrorCode.FORBIDDEN });
      expect(repo.findRoleScoped).not.toHaveBeenCalled();
      expect(repo.softDeleteScopedNonAdmin).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a cross-tenant or missing target (scoped probe returns null)', async () => {
      const { service, repo, sessionRevocation } = await buildSubject();
      repo.findRoleScoped.mockResolvedValue(null);
      await expect(
        withTenant(TENANT_A, () => service.adminDeleteUser('other-tenant-user', 'admin-1')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: AppErrorCode.NOT_FOUND });
      expect(repo.softDeleteScopedNonAdmin).not.toHaveBeenCalled();
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN for an ADMIN target (privilege-escalation guard) and never writes', async () => {
      const { service, repo, sessionRevocation, audit } = await buildSubject();
      repo.findRoleScoped.mockResolvedValue({ id: 'target-2', role: 'ADMIN' });
      await expect(
        withTenant(TENANT_A, () => service.adminDeleteUser('target-2', 'admin-1')),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: AppErrorCode.FORBIDDEN });
      expect(repo.softDeleteScopedNonAdmin).not.toHaveBeenCalled();
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the guarded write matches zero rows (concurrent delete/promotion) and skips teardown', async () => {
      const { service, repo, sessionRevocation, audit } = await buildSubject();
      repo.findRoleScoped.mockResolvedValue(target);
      repo.softDeleteScopedNonAdmin.mockResolvedValue(0);
      await expect(
        withTenant(TENANT_A, () => service.adminDeleteUser('target-1', 'admin-1')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: AppErrorCode.NOT_FOUND });
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('ends the membership, audits it, and closes the sessions they hold', async () => {
      const { service, repo, audit, sessionRevocation } = await buildSubject();

      await withTenant(TENANT_A, () => service.removeMember('u-1', 'u-2'));

      expect(repo.endMembership).toHaveBeenCalledWith('u-2', TENANT_A, expect.any(Date));
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.MEMBER_REMOVED, targetId: 'u-2' }),
      );
      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-2');
    });

    it('audits before the teardown, so a Redis failure cannot erase the trail', async () => {
      const { service, audit, sessionRevocation } = await buildSubject();

      await withTenant(TENANT_A, () => service.removeMember('u-1', 'u-2'));

      expect(audit.log.mock.invocationCallOrder[0]!).toBeLessThan(
        sessionRevocation.revokeAllAndDisconnect.mock.invocationCallOrder[0]!,
      );
    });

    it('refuses to remove yourself', async () => {
      // The last admin doing it strands the organization exactly as a self-demotion
      // would, and there is no case where an admin needs this.
      const { service, repo } = await buildSubject();

      await expect(withTenant(TENANT_A, () => service.removeMember('u-1', 'u-1'))).rejects.toThrow(
        /yourself/,
      );
      expect(repo.endMembership).not.toHaveBeenCalled();
    });

    it('refuses an ADMIN target and names demotion as the route', async () => {
      // Demotion is what routes the act past the owner guard and the last-admin
      // guard; removing an admin directly would step around both.
      const { service, repo } = await buildSubject();
      repo.findMemberScoped.mockResolvedValue({
        id: 'u-2',
        role: 'ADMIN',
        passwordHash: 'h',
        membershipEndedAt: null,
      });

      await expect(withTenant(TENANT_A, () => service.removeMember('u-1', 'u-2'))).rejects.toThrow(
        /[Dd]emote/,
      );
      expect(repo.endMembership).not.toHaveBeenCalled();
    });

    it('refuses a cross-tenant id the same way it refuses a missing one', async () => {
      const { service, repo } = await buildSubject();
      repo.findMemberScoped.mockResolvedValue(null);

      await expect(
        withTenant(TENANT_A, () => service.removeMember('u-1', 'u-elsewhere')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('fails closed with no active tenant', async () => {
      const { service, repo } = await buildSubject();

      await expect(service.removeMember('u-1', 'u-2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(repo.endMembership).not.toHaveBeenCalled();
    });

    it('throws rather than reporting success when the guarded write matches nothing', async () => {
      // Promoted, deleted or already removed between the probe and the write.
      const { service, repo, sessionRevocation } = await buildSubject();
      repo.endMembership.mockResolvedValue(0);

      await expect(
        withTenant(TENANT_A, () => service.removeMember('u-1', 'u-2')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    it('a retry after a failed teardown revokes the sessions instead of answering NotFound', async () => {
      // The flag commits before revokeAuthState runs. If Redis blips there,
      // the admin's retry finds the member already removed; answering NotFound
      // would leave every session they still hold alive with no way to retry.
      const { service, repo, audit, sessionRevocation } = await buildSubject();
      sessionRevocation.revokeAllAndDisconnect.mockRejectedValueOnce(new Error('redis down'));

      await expect(withTenant(TENANT_A, () => service.removeMember('u-1', 'u-2'))).rejects.toThrow(
        'redis down',
      );

      repo.findMemberScoped.mockResolvedValue({
        id: 'u-2',
        role: 'USER',
        passwordHash: 'h',
        membershipEndedAt: new Date('2026-09-19T10:00:00Z'),
      });
      audit.log.mockClear();

      await withTenant(TENANT_A, () => service.removeMember('u-1', 'u-2'));

      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledTimes(2);
      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenLastCalledWith('u-2');
      // Idempotent: the removal happened once and is on the trail once.
      expect(audit.log).not.toHaveBeenCalled();
      expect(repo.endMembership).toHaveBeenCalledTimes(1);
    });

    it('control: a cross-tenant id is still NotFound on the retry path, with nothing revoked', async () => {
      // The idempotent branch hangs off the tenant-scoped probe, so a removed
      // member of ANOTHER organization resolves to nothing and cannot be torn down
      // from here.
      const { service, repo, sessionRevocation } = await buildSubject();
      repo.findMemberScoped.mockResolvedValue(null);

      await expect(
        withTenant(TENANT_A, () => service.removeMember('u-1', 'u-elsewhere')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });
  });

  describe('restoreMember', () => {
    it('restores a removed member and records whether it re-adds an admin', async () => {
      const { service, repo, audit } = await buildSubject();
      repo.findMemberScoped.mockResolvedValue({
        id: 'u-2',
        role: 'ADMIN',
        passwordHash: 'h',
        membershipEndedAt: new Date('2026-05-01T00:00:00Z'),
      });

      await withTenant(TENANT_A, () => service.restoreMember('u-2'));

      expect(repo.restoreMembership).toHaveBeenCalledWith('u-2', TENANT_A);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.MEMBER_RESTORED,
          metadata: expect.objectContaining({ restoresAdmin: true }),
        }),
      );
    });

    it('refuses to restore somebody who never left', async () => {
      // Otherwise the surface reports having restored an active member.
      const { service, repo } = await buildSubject();

      await expect(withTenant(TENANT_A, () => service.restoreMember('u-2'))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(repo.restoreMembership).not.toHaveBeenCalled();
    });

    it('fails closed with no active tenant', async () => {
      const { service } = await buildSubject();

      await expect(service.restoreMember('u-2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
