import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { PasswordChangeService } from './password-change.service';
import {
  TWO_FACTOR_MANAGE_RATE_LIMIT,
  TWO_FACTOR_MANAGE_RATE_WINDOW_SECONDS,
} from '../auth.constants';
import { RateLimitError } from '../../../common/errors';
import { createAuthTestModule } from '@test/test-module';
import { expressMocks, userFixture } from '@test/fixtures';

describe('PasswordChangeService', () => {
  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [PasswordChangeService] });
    return { ...ctx, service: ctx.get(PasswordChangeService) };
  };

  it('budgets the current-password check per user before touching the credential', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
    mocks.password.verify.mockResolvedValue(true);
    mocks.password.hash.mockResolvedValue('new-hash');

    await service.changePassword('u-1', 'oldPw', 'NewStrongPw1!', '127.0.0.1', 'ua', req, res);

    // Per-user, not per-IP: a hijacked session can rotate addresses.
    expect(mocks.shared.enforceRateLimit).toHaveBeenCalledWith(
      'password-change:u-1',
      TWO_FACTOR_MANAGE_RATE_LIMIT,
      TWO_FACTOR_MANAGE_RATE_WINDOW_SECONDS,
    );
  });

  it('RATE_LIMITED short-circuits before any credential read or verify', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.shared.enforceRateLimit.mockRejectedValue(new RateLimitError());

    await expect(
      service.changePassword('u-1', 'oldPw', 'NewStrongPw1!', '127.0.0.1', 'ua', req, res),
    ).rejects.toMatchObject({ appCode: AppErrorCode.RATE_LIMITED });

    // No Argon2 verify means no oracle: the budget is what stops a hijacked
    // session guessing the current password at hash speed.
    expect(mocks.user.findCredentialById).not.toHaveBeenCalled();
    expect(mocks.password.verify).not.toHaveBeenCalled();
    expect(mocks.user.updatePassword).not.toHaveBeenCalled();
  });

  it('happy path: verifies current password, updates, deletes all sessions, creates new session for caller (rememberMe: false), audits, mails', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    const user = userFixture({ id: 'u-1', email: 'a@b.c', emailVerified: true });
    mocks.user.findCredentialById.mockResolvedValue(user);
    mocks.password.verify.mockResolvedValue(true);
    mocks.password.hash.mockResolvedValue('new-hash');
    mocks.user.updatePassword.mockResolvedValue(undefined);

    await service.changePassword('u-1', 'oldPw', 'NewStrongPw1!', '127.0.0.1', 'ua', req, res);

    expect(mocks.password.verify).toHaveBeenCalledWith(user.passwordHash, 'oldPw');
    // The password write and the reset-token revoke share the SAME tx client
    // (the default prisma mock passes `client` as the tx), so a crash between
    // them rolls both back and no still-valid reset token survives the change.
    expect(mocks.prisma.client.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.user.updatePassword).toHaveBeenCalledWith('u-1', 'new-hash', mocks.prisma.client);
    expect(mocks.token.invalidateUserTokens).toHaveBeenCalledWith(
      'u-1',
      'PASSWORD_RESET',
      mocks.prisma.client,
    );
    // Session revocation also drops live sockets (one shared step).
    expect(mocks.sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-1');
    // A pending email change dies with the credential rotation: the tripwire
    // told a possible victim to change the password, so the change must
    // strand any attacker-held confirmation link.
    expect(mocks.emailChange.invalidatePending).toHaveBeenCalledWith('u-1');
    // New session is rememberMe: false (user stays logged in but NOT
    // remember-me); establishSession owns create-session + cookie + CSRF.
    // Exact, not objectContaining: a partial matcher cannot fail on a DROPPED
    // field, and a re-issue exists precisely to reproduce a session faithfully.
    expect(mocks.shared.establishSession).toHaveBeenCalledWith(req, res, {
      userId: 'u-1',
      email: 'a@b.c',
      role: 'USER',
      emailVerified: user.emailVerified,
      ip: '127.0.0.1',
      userAgent: 'ua',
      rememberMe: false,
      tenantId: user.tenantId,
    });
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
        userId: 'u-1',
        targetType: 'User',
        targetId: 'u-1',
      }),
    );
    expect(mocks.mail.sendPasswordChangedEmail).toHaveBeenCalledWith('a@b.c');
  });

  it('throws NOT_FOUND when user does not exist', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(null);

    await expect(
      service.changePassword('u-x', 'old', 'new', 'ip', 'ua', req, res),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: AppErrorCode.NOT_FOUND });
    expect(mocks.password.verify).not.toHaveBeenCalled();
  });

  it('throws UNAUTHORIZED with "Current password is incorrect" when current password is wrong; no update, no session deletion', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture());
    mocks.password.verify.mockResolvedValue(false);

    await expect(
      service.changePassword('u-1', 'wrong', 'new', 'ip', 'ua', req, res),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Current password is incorrect',
      // Distinct appCode so the client can key the current-password field error
      // on a structured code instead of the message text.
      appCode: AppErrorCode.INVALID_CREDENTIALS,
    });
    expect(mocks.password.hash).not.toHaveBeenCalled();
    expect(mocks.user.updatePassword).not.toHaveBeenCalled();
    expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
  });

  it('throws PASSWORD_NOT_SET for an account with no password; never verifies, never writes', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture({ passwordHash: null }));
    // Would say "valid" if it were ever reached; it must not be.
    mocks.password.verify.mockResolvedValue(true);

    await expect(
      service.changePassword('u-1', 'anything', 'NewStrongPw1!', 'ip', 'ua', req, res),
    ).rejects.toMatchObject({
      // BAD_REQUEST, not UNAUTHORIZED: the session is fine, the account simply
      // has no password, so the client must not treat this as a session expiry.
      code: 'BAD_REQUEST',
      appCode: AppErrorCode.PASSWORD_NOT_SET,
    });
    expect(mocks.password.verify).not.toHaveBeenCalled();
    expect(mocks.user.updatePassword).not.toHaveBeenCalled();
    expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
  });

  it('propagates a failed transactional write; no session revoke, no mail', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture());
    mocks.password.verify.mockResolvedValue(true);
    mocks.password.hash.mockResolvedValue('h');
    mocks.user.updatePassword.mockRejectedValue(new Error('DB down'));

    await expect(service.changePassword('u-1', 'old', 'new', 'ip', 'ua', req, res)).rejects.toThrow(
      'DB down',
    );
    expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    expect(mocks.mail.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it('still resolves when post-change notification email fails', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture());
    mocks.password.verify.mockResolvedValue(true);
    mocks.password.hash.mockResolvedValue('h');
    mocks.mail.sendPasswordChangedEmail.mockRejectedValue(new Error('SMTP'));

    await expect(
      service.changePassword('u-1', 'old', 'new', 'ip', 'ua', req, res),
    ).resolves.toBeUndefined();
    expect(mocks.audit.log).toHaveBeenCalled();
  });

  it('order: revokeAllAndDisconnect runs BEFORE establishSession (caller stays logged in via the fresh session)', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findCredentialById.mockResolvedValue(userFixture());
    mocks.password.verify.mockResolvedValue(true);
    mocks.password.hash.mockResolvedValue('h');

    const callOrder: string[] = [];
    mocks.sessionRevocation.revokeAllAndDisconnect.mockImplementation(async () => {
      callOrder.push('revokeAll');
    });
    mocks.shared.establishSession.mockImplementation(async () => {
      callOrder.push('establish');
      return { token: 't', expiresAt: new Date(Date.now() + 1000) };
    });

    await service.changePassword('u-1', 'old', 'new', 'ip', 'ua', req, res);

    expect(callOrder).toEqual(['revokeAll', 'establish']);
  });
});
