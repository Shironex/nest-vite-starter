import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AccountDeletionService } from './account-deletion.service';
import { createAuthTestModule } from '@test/test-module';
import { expressMocks, userFixture } from '@test/fixtures';

describe('AccountDeletionService', () => {
  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [AccountDeletionService] });
    return { ...ctx, service: ctx.get(AccountDeletionService) };
  };

  it('happy path: rate-limits, verifies the password, soft-deletes, audits, revokes auth state, clears cookie + rotates CSRF', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    const user = userFixture({ id: 'u-1', email: 'a@b.c' });
    mocks.user.findCredentialById.mockResolvedValue(user);
    mocks.password.verify.mockResolvedValue(true);
    mocks.user.softDeleteSelfKeepingOneAdmin.mockResolvedValue(1);

    await service.deleteAccount('u-1', 'CorrectPw1!', '127.0.0.1', 'ua', req, res);

    // Per-user fixed window: the endpoint verifies a password, so it must not
    // be a free brute-force oracle (tRPC bypasses the HTTP ThrottlerGuard).
    expect(mocks.shared.enforceRateLimit).toHaveBeenCalledWith(
      'delete-account:u-1',
      expect.any(Number),
      expect.any(Number),
    );
    expect(mocks.password.verify).toHaveBeenCalledWith(user.passwordHash, 'CorrectPw1!');
    expect(mocks.user.softDeleteSelfKeepingOneAdmin).toHaveBeenCalledWith(user);
    expect(mocks.audit.log).toHaveBeenCalledWith({
      action: AUDIT_ACTIONS.USER_ACCOUNT_DELETED,
      userId: 'u-1',
      targetType: 'User',
      targetId: 'u-1',
      ipAddress: '127.0.0.1',
      userAgent: 'ua',
    });
    expect(mocks.user.revokeAuthState).toHaveBeenCalledWith('u-1');
    expect(mocks.shared.clearSessionCookie).toHaveBeenCalledWith(res);
    expect(mocks.csrf.rotate).toHaveBeenCalledWith(req, res);
  });

  it('order: soft delete -> audit -> revokeAuthState -> clearSessionCookie', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture());
    mocks.password.verify.mockResolvedValue(true);

    const callOrder: string[] = [];
    mocks.user.softDeleteSelfKeepingOneAdmin.mockImplementation(async () => {
      callOrder.push('softDelete');
      return 1;
    });
    mocks.audit.log.mockImplementation(async () => {
      callOrder.push('audit');
    });
    mocks.user.revokeAuthState.mockImplementation(async () => {
      callOrder.push('revoke');
    });
    mocks.shared.clearSessionCookie.mockImplementation(() => {
      callOrder.push('clearCookie');
    });

    await service.deleteAccount('u-1', 'pw', 'ip', 'ua', req, res);

    expect(callOrder).toEqual(['softDelete', 'audit', 'revoke', 'clearCookie']);
  });

  it('throws NOT_FOUND when the user is missing or already soft-deleted at the credential read', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(null);

    await expect(service.deleteAccount('ghost', 'pw', 'ip', 'ua', req, res)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: AppErrorCode.NOT_FOUND,
    });
    expect(mocks.password.verify).not.toHaveBeenCalled();
    expect(mocks.user.softDeleteSelfKeepingOneAdmin).not.toHaveBeenCalled();
  });

  it('throws UNAUTHORIZED with appCode INVALID_CREDENTIALS on a wrong password; nothing is deleted or revoked', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture());
    mocks.password.verify.mockResolvedValue(false);

    await expect(service.deleteAccount('u-1', 'wrong', 'ip', 'ua', req, res)).rejects.toMatchObject(
      {
        code: 'UNAUTHORIZED',
        message: 'Password is incorrect',
        // Distinct appCode so the client can attach the error to the password
        // field instead of treating it as a session expiry.
        appCode: AppErrorCode.INVALID_CREDENTIALS,
      },
    );
    expect(mocks.user.softDeleteSelfKeepingOneAdmin).not.toHaveBeenCalled();
    expect(mocks.user.revokeAuthState).not.toHaveBeenCalled();
    expect(mocks.audit.log).not.toHaveBeenCalled();
    expect(mocks.shared.clearSessionCookie).not.toHaveBeenCalled();
  });

  it('throws PASSWORD_NOT_SET for an OAuth-only account; nothing is deleted or revoked', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture({ passwordHash: null }));
    // Would confirm the deletion if it were ever reached. A missing hash must
    // never read as "password confirmed" on a destructive action.
    mocks.password.verify.mockResolvedValue(true);

    await expect(
      service.deleteAccount('u-1', 'anything', 'ip', 'ua', req, res),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      appCode: AppErrorCode.PASSWORD_NOT_SET,
    });
    expect(mocks.password.verify).not.toHaveBeenCalled();
    expect(mocks.user.softDeleteSelfKeepingOneAdmin).not.toHaveBeenCalled();
    expect(mocks.user.revokeAuthState).not.toHaveBeenCalled();
    expect(mocks.shared.clearSessionCookie).not.toHaveBeenCalled();
  });

  it('propagates the rate-limit error before touching the credential', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.shared.enforceRateLimit.mockRejectedValue(new Error('rate limited'));

    await expect(service.deleteAccount('u-1', 'pw', 'ip', 'ua', req, res)).rejects.toThrow(
      'rate limited',
    );
    expect(mocks.user.findCredentialById).not.toHaveBeenCalled();
  });

  it('treats a zero-row soft delete (concurrent double-delete) as idempotent success and still tears down', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture());
    mocks.password.verify.mockResolvedValue(true);
    mocks.user.softDeleteSelfKeepingOneAdmin.mockResolvedValue(0);

    await expect(service.deleteAccount('u-1', 'pw', 'ip', 'ua', req, res)).resolves.toBeUndefined();
    expect(mocks.user.revokeAuthState).toHaveBeenCalledWith('u-1');
    expect(mocks.shared.clearSessionCookie).toHaveBeenCalledWith(res);
  });

  it('propagates a failed soft delete; no audit, no revocation, no cookie clear', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture());
    mocks.password.verify.mockResolvedValue(true);
    mocks.user.softDeleteSelfKeepingOneAdmin.mockRejectedValue(new Error('DB down'));

    await expect(service.deleteAccount('u-1', 'pw', 'ip', 'ua', req, res)).rejects.toThrow(
      'DB down',
    );
    expect(mocks.audit.log).not.toHaveBeenCalled();
    expect(mocks.user.revokeAuthState).not.toHaveBeenCalled();
    expect(mocks.shared.clearSessionCookie).not.toHaveBeenCalled();
  });
});
