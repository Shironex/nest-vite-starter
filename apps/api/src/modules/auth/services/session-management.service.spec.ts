import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { expressMocks } from '@test/fixtures';
import { sha256Hex } from '../../../common/utils/crypto';
import { SessionManagementService } from './session-management.service';

type Deps = ConstructorParameters<typeof SessionManagementService>;

const buildSubject = () => {
  const sessionService = {
    getUserSessions: jest.fn().mockResolvedValue([]),
    deleteUserSessionById: jest.fn().mockResolvedValue(true),
    validateSession: jest.fn().mockResolvedValue(null),
    isRememberMeSession: jest.fn().mockReturnValue(false),
  };
  const sessionRevocation = { revokeAllAndDisconnect: jest.fn().mockResolvedValue(undefined) };
  const eventsService = { disconnectUser: jest.fn(), disconnectSession: jest.fn() };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const shared = {
    establishSession: jest.fn().mockResolvedValue({ token: 't', expiresAt: new Date() }),
  };
  const service = new SessionManagementService(
    sessionService as unknown as Deps[0],
    sessionRevocation as unknown as Deps[1],
    eventsService as unknown as Deps[2],
    auditService as unknown as Deps[3],
    shared as unknown as Deps[4],
  );
  return { service, sessionService, sessionRevocation, eventsService, auditService, shared };
};

const sessionInfo = (sessionId: string, overrides: Partial<Record<string, unknown>> = {}) => ({
  sessionId,
  ip: '1.2.3.4',
  userAgent: 'jest-ua',
  createdAt: 1_000,
  lastActive: 2_000,
  ...overrides,
});

const requestMeta = { ip: '9.9.9.9', userAgent: 'revoker-ua' };

describe('SessionManagementService', () => {
  describe('listSessions', () => {
    it('maps rows to the wire shape: opaque id, no server-side sessionId', async () => {
      const { service, sessionService } = buildSubject();
      sessionService.getUserSessions.mockResolvedValue([sessionInfo('raw-id-1')]);

      const rows = await service.listSessions('u-1', 'raw-id-1');

      expect(rows).toEqual([
        {
          id: sha256Hex('raw-id-1'),
          ip: '1.2.3.4',
          userAgent: 'jest-ua',
          createdAt: 1_000,
          lastActive: 2_000,
          isCurrent: true,
        },
      ]);
      // The raw id must not survive under ANY key.
      expect(JSON.stringify(rows)).not.toContain('raw-id-1');
    });

    it('flags only the caller session as current', async () => {
      const { service, sessionService } = buildSubject();
      sessionService.getUserSessions.mockResolvedValue([
        sessionInfo('current-id'),
        sessionInfo('other-id'),
      ]);

      const rows = await service.listSessions('u-1', 'current-id');

      expect(rows.map((row) => row.isCurrent)).toEqual([true, false]);
    });

    it('sorts current first, then newest activity first', async () => {
      const { service, sessionService } = buildSubject();
      sessionService.getUserSessions.mockResolvedValue([
        sessionInfo('stale', { lastActive: 100 }),
        sessionInfo('fresh', { lastActive: 900 }),
        sessionInfo('current', { lastActive: 500 }),
      ]);

      const rows = await service.listSessions('u-1', 'current');

      expect(rows.map((row) => row.id)).toEqual([
        sha256Hex('current'),
        sha256Hex('fresh'),
        sha256Hex('stale'),
      ]);
    });
  });

  describe('revokeSession', () => {
    it('resolves the public handle back to the raw id and deletes it', async () => {
      const { service, sessionService, eventsService, auditService } = buildSubject();
      sessionService.getUserSessions.mockResolvedValue([
        sessionInfo('keep-id'),
        sessionInfo('drop-id'),
      ]);

      await service.revokeSession('u-1', sha256Hex('drop-id'), requestMeta);

      expect(sessionService.deleteUserSessionById).toHaveBeenCalledWith('u-1', 'drop-id');
      // Only the revoked session's sockets: a user-wide drop would sign every
      // other device out too.
      expect(eventsService.disconnectSession).toHaveBeenCalledWith('drop-id');
      expect(eventsService.disconnectUser).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_SESSION_REVOKED,
          userId: 'u-1',
          metadata: { sessionRef: sha256Hex('drop-id') },
        }),
      );
    });

    it('acks an unknown handle without deleting, disconnecting, or auditing', async () => {
      const { service, sessionService, eventsService, auditService } = buildSubject();
      sessionService.getUserSessions.mockResolvedValue([sessionInfo('keep-id')]);

      await expect(
        service.revokeSession('u-1', sha256Hex('not-mine'), requestMeta),
      ).resolves.toBeUndefined();

      expect(sessionService.deleteUserSessionById).not.toHaveBeenCalled();
      expect(eventsService.disconnectSession).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('skips disconnect and audit when the delete lost a race', async () => {
      const { service, sessionService, eventsService, auditService } = buildSubject();
      sessionService.getUserSessions.mockResolvedValue([sessionInfo('drop-id')]);
      sessionService.deleteUserSessionById.mockResolvedValue(false);

      await service.revokeSession('u-1', sha256Hex('drop-id'), requestMeta);

      expect(eventsService.disconnectSession).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('leaves the caller other sessions alone: one handle, one room', async () => {
      const { service, sessionService, eventsService } = buildSubject();
      sessionService.getUserSessions.mockResolvedValue([
        sessionInfo('keep-id'),
        sessionInfo('drop-id'),
      ]);

      await service.revokeSession('u-1', sha256Hex('drop-id'), requestMeta);

      expect(eventsService.disconnectSession).toHaveBeenCalledTimes(1);
      expect(eventsService.disconnectSession).not.toHaveBeenCalledWith('keep-id');
    });
  });

  describe('revokeOtherSessions', () => {
    const currentBlob = {
      sessionId: 'current-id',
      userId: 'u-1',
      email: 'e@x.io',
      role: 'USER',
      emailVerified: true,
      ip: '1.2.3.4',
      userAgent: 'old-ua',
      createdAt: 1_000,
      lastActive: 2_000,
      expiresAt: 3_000,
      epoch: 4,
      tenantId: 'tenant-1',
    };

    const callIt = (service: SessionManagementService) => {
      const { req, res } = expressMocks();
      return service
        .revokeOtherSessions('raw-token', '9.9.9.9', 'new-ua', req, res)
        .then(() => ({ req, res }));
    };

    it('fails closed with SESSION_EXPIRED when the current session is gone', async () => {
      const { service, sessionRevocation, shared } = buildSubject();

      await expect(callIt(service)).rejects.toMatchObject({
        appCode: AppErrorCode.SESSION_EXPIRED,
      });
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(shared.establishSession).not.toHaveBeenCalled();
    });

    it('revokes everything FIRST, then re-issues from the current blob', async () => {
      const { service, sessionService, sessionRevocation, shared } = buildSubject();
      sessionService.validateSession.mockResolvedValue(currentBlob);

      await callIt(service);

      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-1');
      // Order is the fence contract: the bump must land before the mint reads
      // the counter, or the replacement session fences itself out.
      expect(sessionRevocation.revokeAllAndDisconnect.mock.invocationCallOrder[0]).toBeLessThan(
        shared.establishSession.mock.invocationCallOrder[0]!,
      );

      const params = shared.establishSession.mock.calls[0]![2];
      // toEqual, NOT toMatchObject. A partial matcher passes whatever the
      // re-issue happens to carry, so it is structurally blind to a DROPPED
      // field, which is exactly the bug class this re-issue is prone to: the
      // whole point of the call is to reproduce a session faithfully, and the
      // failure mode is silent omission rather than a wrong value.
      expect(params).toEqual({
        userId: 'u-1',
        email: 'e@x.io',
        role: 'USER',
        emailVerified: true,
        ip: '9.9.9.9',
        userAgent: 'new-ua',
        rememberMe: false,
        tenantId: 'tenant-1',
      });
      // NO epoch: the mint must read the counter the revocation just bumped.
      expect(params).not.toHaveProperty('epoch');
    });

    it('preserves remember-me on the re-issued session', async () => {
      const { service, sessionService, shared } = buildSubject();
      sessionService.validateSession.mockResolvedValue(currentBlob);
      sessionService.isRememberMeSession.mockReturnValue(true);

      await callIt(service);

      expect(sessionService.isRememberMeSession).toHaveBeenCalledWith(currentBlob);
      expect(shared.establishSession.mock.calls[0]![2]).toMatchObject({ rememberMe: true });
    });

    it('audits auth.logout.others for the caller', async () => {
      const { service, sessionService, auditService } = buildSubject();
      sessionService.validateSession.mockResolvedValue(currentBlob);

      await callIt(service);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_LOGOUT_OTHERS,
          userId: 'u-1',
          targetType: 'User',
          targetId: 'u-1',
        }),
      );
    });
  });
});
