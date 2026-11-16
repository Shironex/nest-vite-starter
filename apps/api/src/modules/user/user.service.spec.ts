import { Test } from '@nestjs/testing';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { SessionService } from '../auth/services/session.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../common/database/prisma.service';
import { userFixture, userProfileFixture } from '@test/fixtures';

const buildSubject = async () => {
  const repo = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findCredentialById: jest.fn(),
    findCredentialByEmail: jest.fn(),
    getProfile: jest.fn(),
    listUsers: jest.fn(),
    verifyEmail: jest.fn(),
    updatePassword: jest.fn(),
    updateRole: jest.fn().mockResolvedValue(1),
    softDelete: jest.fn(),
    findRole: jest.fn(),
    softDeleteNonAdmin: jest.fn(),
    lockAdminSet: jest.fn().mockResolvedValue(undefined),
    // Two by default: a demotion is allowed. Tests that care about the guard
    // set it explicitly.
    countLiveAdmins: jest.fn().mockResolvedValue(2),
    countOtherLiveUsers: jest.fn().mockResolvedValue(0),
    // An ordinary active USER: the target every disable case varies.
    findForDisable: jest.fn().mockResolvedValue({ id: 'u-2', role: 'USER', disabledAt: null }),
    disable: jest.fn().mockResolvedValue(1),
    enable: jest.fn().mockResolvedValue(1),
  };
  const sessionService = { deleteAllUserSessions: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // The demotion guard runs its count and its write on one transaction; the
  // callback is invoked with the same mocked repo, so assertions are unchanged.
  const prisma = { client: { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) } };
  const module = await Test.createTestingModule({
    providers: [
      UserService,
      { provide: UserRepository, useValue: repo },
      { provide: SessionService, useValue: sessionService },
      { provide: AuditService, useValue: audit },
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return {
    service: module.get(UserService),
    repo,
    sessionService,
    audit,
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

    it('listUsers → repo.listUsers with the pagination params', async () => {
      const { service, repo } = await buildSubject();
      const page = { items: [], nextCursor: null };
      repo.listUsers.mockResolvedValue(page);
      await expect(service.listUsers({ limit: 50 })).resolves.toEqual(page);
      expect(repo.listUsers).toHaveBeenCalledWith({ limit: 50 });
    });

    it('listUsers forwards an explicit cursor', async () => {
      const { service, repo } = await buildSubject();
      repo.listUsers.mockResolvedValue({ items: [], nextCursor: null });
      await service.listUsers({ cursor: 'u-9', limit: 10 });
      expect(repo.listUsers).toHaveBeenCalledWith({ cursor: 'u-9', limit: 10 });
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

      const result = await service.listUsers({ limit: 50 });

      expect(result.items.map((u) => ({ id: u.id, twoFactorEnabled: u.twoFactorEnabled }))).toEqual(
        [
          { id: 'u-1', twoFactorEnabled: true },
          { id: 'u-2', twoFactorEnabled: false },
        ],
      );
    });
  });

  describe('assertDeletionLeavesNobodyStranded', () => {
    /**
     * deleteAccount soft-deletes whatever role it is given, so the last ADMIN
     * could erase themselves and leave everyone else with no admin and no
     * in-app way to appoint one.
     */
    it('refuses when the last admin would strand other users', async () => {
      const { service, repo } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(1);
      repo.countOtherLiveUsers.mockResolvedValue(3);

      await expect(
        service.assertDeletionLeavesNobodyStranded({ id: 'u-1', role: 'ADMIN' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(repo.countOtherLiveUsers).toHaveBeenCalledWith('u-1', undefined);
    });

    it('allows a sole user to delete their own account', async () => {
      const { service, repo } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(1);
      repo.countOtherLiveUsers.mockResolvedValue(0);

      await expect(
        service.assertDeletionLeavesNobodyStranded({ id: 'u-1', role: 'ADMIN' }),
      ).resolves.toBeUndefined();
    });

    it('allows an admin to leave when another admin remains', async () => {
      const { service, repo } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(2);

      await expect(
        service.assertDeletionLeavesNobodyStranded({ id: 'u-1', role: 'ADMIN' }),
      ).resolves.toBeUndefined();
      expect(repo.countOtherLiveUsers).not.toHaveBeenCalled();
    });

    it('does not count anything for a non-admin', async () => {
      const { service, repo } = await buildSubject();

      await service.assertDeletionLeavesNobodyStranded({ id: 'u-1', role: 'USER' });

      expect(repo.countLiveAdmins).not.toHaveBeenCalled();
      expect(repo.countOtherLiveUsers).not.toHaveBeenCalled();
    });
  });

  describe('softDeleteSelfKeepingOneAdmin', () => {
    it('takes the admin-set lock before counting, on the same transaction', async () => {
      const { service, repo, prisma } = await buildSubject();
      repo.softDelete.mockResolvedValue(1);

      await expect(
        service.softDeleteSelfKeepingOneAdmin({ id: 'u-1', role: 'ADMIN' }),
      ).resolves.toBe(1);

      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(repo.lockAdminSet).toHaveBeenCalledWith({});
      expect(repo.lockAdminSet.mock.invocationCallOrder[0]!).toBeLessThan(
        repo.countLiveAdmins.mock.invocationCallOrder[0]!,
      );
      expect(repo.softDelete).toHaveBeenCalledWith('u-1', {});
    });

    it('refuses inside the lock when the deletion would strand other users', async () => {
      const { service, repo } = await buildSubject();
      repo.countLiveAdmins.mockResolvedValue(1);
      repo.countOtherLiveUsers.mockResolvedValue(2);

      await expect(
        service.softDeleteSelfKeepingOneAdmin({ id: 'u-1', role: 'ADMIN' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('does not take the lock for a non-admin, who cannot strand anyone', async () => {
      const { service, repo, prisma } = await buildSubject();
      repo.softDelete.mockResolvedValue(1);

      await service.softDeleteSelfKeepingOneAdmin({ id: 'u-1', role: 'USER' });

      expect(prisma.client.$transaction).not.toHaveBeenCalled();
      expect(repo.lockAdminSet).not.toHaveBeenCalled();
      expect(repo.softDelete).toHaveBeenCalledWith('u-1');
    });

    it('reports zero rows rather than throwing', async () => {
      const { service, repo } = await buildSubject();
      repo.softDelete.mockResolvedValue(0);

      await expect(
        service.softDeleteSelfKeepingOneAdmin({ id: 'u-1', role: 'USER' }),
      ).resolves.toBe(0);
    });
  });

  describe('updateRole', () => {
    /** The pre-change row the audit `before` is taken from. */
    const existingUser = (repo: { findRole: jest.Mock }, role = 'USER') =>
      repo.findRole.mockResolvedValue({ id: 'u-1', role });

    it('updates the role, then revokes sessions', async () => {
      const { service, repo, sessionService } = await buildSubject();
      existingUser(repo);

      await service.updateRole('actor-1', 'u-1', 'ADMIN');

      expect(repo.updateRole).toHaveBeenCalledWith('u-1', 'ADMIN');
      expect(sessionService.deleteAllUserSessions).toHaveBeenCalledWith('u-1');
      // The DB write lands before the sessions are dropped.
      expect(repo.updateRole.mock.invocationCallOrder[0]!).toBeLessThan(
        sessionService.deleteAllUserSessions.mock.invocationCallOrder[0]!,
      );
    });

    it('audits the change with the old and new role, before the teardown', async () => {
      const { service, repo, audit, sessionService } = await buildSubject();
      existingUser(repo, 'USER');

      await service.updateRole('actor-1', 'u-1', 'ADMIN');

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
        sessionService.deleteAllUserSessions.mock.invocationCallOrder[0]!,
      );
      expect(repo.updateRole.mock.invocationCallOrder[0]!).toBeLessThan(
        audit.log.mock.invocationCallOrder[0]!,
      );
    });

    it('does not revoke sessions when the role update throws', async () => {
      const { service, repo, sessionService } = await buildSubject();
      existingUser(repo);
      repo.updateRole.mockRejectedValue(new Error('DB down'));

      await expect(service.updateRole('actor-1', 'u-1', 'ADMIN')).rejects.toThrow('DB down');
      expect(sessionService.deleteAllUserSessions).not.toHaveBeenCalled();
    });

    /**
     * The procedure is admin-gated, so self PROMOTION is meaningless. What is
     * left is self-demotion, and it is how the app loses its last admin:
     * promotion requires an admin, so nobody remains who can put it back.
     */
    it("refuses to change the caller's own role, before it reads anything", async () => {
      const { service, repo, audit } = await buildSubject();

      await expect(service.updateRole('u-1', 'u-1', 'USER')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(repo.findRole).not.toHaveBeenCalled();
      expect(repo.updateRole).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('refuses to demote the last admin, and writes nothing', async () => {
      const { service, repo, audit, sessionService } = await buildSubject();
      existingUser(repo, 'ADMIN');
      repo.countLiveAdmins.mockResolvedValue(0);

      await expect(service.updateRole('actor-1', 'u-1', 'USER')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(repo.updateRole).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(sessionService.deleteAllUserSessions).not.toHaveBeenCalled();
    });

    it('demotes an admin while another one remains, on the locked transaction', async () => {
      const { service, repo } = await buildSubject();
      existingUser(repo, 'ADMIN');
      repo.countLiveAdmins.mockResolvedValue(1);

      await service.updateRole('actor-1', 'u-1', 'USER');

      expect(repo.updateRole).toHaveBeenCalledWith('u-1', 'USER', {});
    });

    it('counts the admins OTHER than the target', async () => {
      const { service, repo } = await buildSubject();
      existingUser(repo, 'ADMIN');

      await service.updateRole('actor-1', 'u-1', 'USER');

      expect(repo.countLiveAdmins).toHaveBeenCalledWith({}, 'u-1');
    });

    it('takes the admin-set lock before counting, on the same transaction', async () => {
      const { service, repo } = await buildSubject();
      existingUser(repo, 'ADMIN');

      await service.updateRole('actor-1', 'u-1', 'USER');

      expect(repo.lockAdminSet).toHaveBeenCalledWith({});
      expect(repo.lockAdminSet.mock.invocationCallOrder[0]!).toBeLessThan(
        repo.countLiveAdmins.mock.invocationCallOrder[0]!,
      );
    });

    it('promotes without taking the lock or counting admins', async () => {
      const { service, repo, prisma } = await buildSubject();
      existingUser(repo, 'USER');

      await service.updateRole('actor-1', 'u-1', 'ADMIN');

      expect(prisma.client.$transaction).not.toHaveBeenCalled();
      expect(repo.lockAdminSet).not.toHaveBeenCalled();
      expect(repo.countLiveAdmins).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a missing target and never writes, revokes or audits', async () => {
      const { service, repo, audit, sessionService } = await buildSubject();
      repo.findRole.mockResolvedValue(null);

      await expect(service.updateRole('actor-1', 'gone-user', 'ADMIN')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
      expect(repo.findRole).toHaveBeenCalledWith('gone-user');
      expect(repo.updateRole).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(sessionService.deleteAllUserSessions).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND and does not audit when the row moves between probe and write', async () => {
      const { service, repo, audit } = await buildSubject();
      existingUser(repo);
      // Deleted in the gap: nothing changed, so nothing to log.
      repo.updateRole.mockResolvedValue(0);

      await expect(service.updateRole('actor-1', 'u-1', 'ADMIN')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(audit.log).not.toHaveBeenCalled();
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
    const target = { id: 'target-1', role: 'USER' };

    it('soft-deletes the target, revokes sessions, then audits', async () => {
      const { service, repo, sessionService, audit } = await buildSubject();
      repo.findRole.mockResolvedValue(target);
      repo.softDeleteNonAdmin.mockResolvedValue(1);

      await service.adminDeleteUser('target-1', 'admin-1');

      expect(repo.findRole).toHaveBeenCalledWith('target-1');
      expect(repo.softDeleteNonAdmin).toHaveBeenCalledWith('target-1');
      expect(sessionService.deleteAllUserSessions).toHaveBeenCalledWith('target-1');
      expect(audit.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.USER_ACCOUNT_ADMIN_DELETED,
        targetType: 'User',
        targetId: 'target-1',
      });
      // DB write first, then revoke (same contract as updateRole).
      expect(repo.softDeleteNonAdmin.mock.invocationCallOrder[0]!).toBeLessThan(
        sessionService.deleteAllUserSessions.mock.invocationCallOrder[0]!,
      );
    });

    it('throws FORBIDDEN for a self-delete through the admin path (self-service owns that)', async () => {
      const { service, repo } = await buildSubject();
      await expect(service.adminDeleteUser('admin-1', 'admin-1')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(repo.findRole).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND for a missing target', async () => {
      const { service, repo } = await buildSubject();
      repo.findRole.mockResolvedValue(null);
      await expect(service.adminDeleteUser('gone-user', 'admin-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(repo.softDeleteNonAdmin).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN for an ADMIN target (privilege-escalation guard) and never writes', async () => {
      const { service, repo } = await buildSubject();
      repo.findRole.mockResolvedValue({ id: 'target-2', role: 'ADMIN' });
      await expect(service.adminDeleteUser('target-2', 'admin-1')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(repo.softDeleteNonAdmin).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the guarded write matches zero rows (concurrent delete/promotion) and skips teardown', async () => {
      const { service, repo, sessionService, audit } = await buildSubject();
      repo.findRole.mockResolvedValue(target);
      repo.softDeleteNonAdmin.mockResolvedValue(0);
      await expect(service.adminDeleteUser('target-1', 'admin-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(sessionService.deleteAllUserSessions).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('disableUser', () => {
    it('disables the account, audits it, and closes the sessions it holds', async () => {
      const { service, repo, audit, sessionService } = await buildSubject();

      await service.disableUser('u-1', 'u-2');

      expect(repo.disable).toHaveBeenCalledWith('u-2', expect.any(Date));
      expect(audit.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.USER_DISABLED,
        targetType: 'User',
        targetId: 'u-2',
        metadata: { role: 'USER' },
      });
      expect(sessionService.deleteAllUserSessions).toHaveBeenCalledWith('u-2');
    });

    it('audits before the teardown, so a Redis failure cannot erase the trail', async () => {
      const { service, audit, sessionService } = await buildSubject();

      await service.disableUser('u-1', 'u-2');

      expect(audit.log.mock.invocationCallOrder[0]!).toBeLessThan(
        sessionService.deleteAllUserSessions.mock.invocationCallOrder[0]!,
      );
    });

    it('refuses to disable yourself', async () => {
      const { service, repo } = await buildSubject();

      await expect(service.disableUser('u-1', 'u-1')).rejects.toThrow(
        'You cannot disable your own account',
      );
      expect(repo.findForDisable).not.toHaveBeenCalled();
    });

    it('refuses an ADMIN target and names demotion as the route', async () => {
      // Demotion is what routes the act past the last-admin guard.
      const { service, repo } = await buildSubject();
      repo.findForDisable.mockResolvedValue({ id: 'u-2', role: 'ADMIN', disabledAt: null });

      await expect(service.disableUser('u-1', 'u-2')).rejects.toThrow(
        'Demote this admin before disabling them',
      );
      expect(repo.disable).not.toHaveBeenCalled();
    });

    it('refuses a missing account with NOT_FOUND', async () => {
      const { service, repo } = await buildSubject();
      repo.findForDisable.mockResolvedValue(null);

      await expect(service.disableUser('u-1', 'gone-user')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('throws rather than reporting success when the guarded write matches nothing', async () => {
      const { service, repo, audit } = await buildSubject();
      repo.disable.mockResolvedValue(0);

      await expect(service.disableUser('u-1', 'u-2')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('a retry after a failed teardown revokes the sessions instead of answering NotFound', async () => {
      const { service, repo, audit, sessionService } = await buildSubject();
      sessionService.deleteAllUserSessions.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.disableUser('u-1', 'u-2')).rejects.toThrow('redis down');
      expect(audit.log).toHaveBeenCalledTimes(1);

      // The flag committed; the retry finds the account already disabled.
      repo.findForDisable.mockResolvedValue({
        id: 'u-2',
        role: 'USER',
        disabledAt: new Date('2026-09-19T10:00:00Z'),
      });
      await service.disableUser('u-1', 'u-2');

      expect(sessionService.deleteAllUserSessions).toHaveBeenCalledTimes(2);
      expect(repo.disable).toHaveBeenCalledTimes(1);
      // No second USER_DISABLED row for the same act.
      expect(audit.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('enableUser', () => {
    it('enables a disabled account and records whether it re-admits an admin', async () => {
      const { service, repo, audit } = await buildSubject();
      repo.findForDisable.mockResolvedValue({
        id: 'u-2',
        role: 'ADMIN',
        disabledAt: new Date('2026-05-01T00:00:00Z'),
      });

      await service.enableUser('u-2');

      expect(repo.enable).toHaveBeenCalledWith('u-2');
      expect(audit.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.USER_ENABLED,
        targetType: 'User',
        targetId: 'u-2',
        metadata: { role: 'ADMIN', restoresAdmin: true },
      });
    });

    it('refuses to enable somebody who was never disabled', async () => {
      const { service, repo } = await buildSubject();

      await expect(service.enableUser('u-2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(repo.enable).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the guarded write matches nothing', async () => {
      const { service, repo, audit } = await buildSubject();
      repo.findForDisable.mockResolvedValue({ id: 'u-2', role: 'USER', disabledAt: new Date() });
      repo.enable.mockResolvedValue(0);

      await expect(service.enableUser('u-2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
