import { TRPCError } from '@trpc/server';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { LoginService, TIMING_EQUALIZATION_HASH } from './login.service';
import { ARGON2_OPTIONS } from './password.service';
import { createAuthTestModule } from '@test/test-module';
import { expressMocks, userFixture, userProfileFixture } from '@test/fixtures';

describe('LoginService', () => {
  const baseInput = {
    email: 'user@example.com',
    password: 'CorrectHorseBatteryStaple1!',
    rememberMe: false,
    turnstileToken: 'tok',
  };

  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [LoginService] });
    return { ...ctx, service: ctx.get(LoginService) };
  };

  describe('login()', () => {
    it('happy path: validates credentials, delegates to the 2FA seam, audits success', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      const user = userFixture({ id: 'u-1', emailVerified: true });
      mocks.user.findCredentialByEmail.mockResolvedValue(user);
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      mocks.password.verify.mockResolvedValue(true);
      mocks.lockout.resetAttempts.mockResolvedValue(undefined);

      const result = await service.login(baseInput, '127.0.0.1', 'ua', req, res);

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') throw new Error('expected ok arm');
      expect(result.requiresVerification).toBe(false);
      // The profile is projected from the credential row already in hand: no
      // second SELECT (getProfile) and no DB lockout re-read (isLocked) on the
      // login hot path, and no credential field may leak into the response.
      expect(result.user).toEqual(userProfileFixture({ id: 'u-1', emailVerified: true }));
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(mocks.user.getProfile).not.toHaveBeenCalled();
      expect(mocks.lockout.isLocked).not.toHaveBeenCalled();
      expect(mocks.lockout.isLockedFromUser).toHaveBeenCalledWith(user);
      expect(mocks.password.verify).toHaveBeenCalledWith(user.passwordHash, baseInput.password);
      expect(mocks.lockout.resetAttempts).toHaveBeenCalledWith('u-1');
      // Session + cookie + CSRF rotation now live behind the seam; login never
      // calls establishSession directly.
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
      expect(mocks.twoFactorChallenge.beginOrEstablish).toHaveBeenCalledWith(
        req,
        res,
        expect.objectContaining({ id: 'u-1' }),
        expect.objectContaining({ rememberMe: false, ip: '127.0.0.1', userAgent: 'ua' }),
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
          userId: 'u-1',
          metadata: { rememberMe: false },
        }),
      );
    });

    it('returns the twofa_required arm (no session, no login-success audit) when the seam challenges', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(
        userFixture({ id: 'u-1', emailVerified: true }),
      );
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      mocks.password.verify.mockResolvedValue(true);
      mocks.twoFactorChallenge.beginOrEstablish.mockResolvedValue({
        kind: 'challenge',
        methods: ['TOTP'],
      });

      const result = await service.login(baseInput, '1.2.3.4', 'ua', req, res);

      expect(result).toEqual({ status: 'twofa_required', methods: ['TOTP'] });
      // resetAttempts still fired (the password WAS correct), but no login-success
      // audit yet; that waits for AUTH_2FA_CHALLENGE_SUCCESS at verify.
      expect(mocks.lockout.resetAttempts).toHaveBeenCalledWith('u-1');
      expect(mocks.audit.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS }),
      );
    });

    it('returns requiresVerification: true when user.emailVerified is false', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture({ emailVerified: false }));
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      mocks.password.verify.mockResolvedValue(true);

      const result = await service.login(baseInput, '1.2.3.4', 'ua', req, res);

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') throw new Error('expected ok arm');
      expect(result.requiresVerification).toBe(true);
      expect(result.user.emailVerified).toBe(false);
    });

    it('captures the session epoch BEFORE verifying the password and forwards it to the seam', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture({ emailVerified: true }));
      const order: string[] = [];
      mocks.session.readEpoch.mockImplementation(async () => {
        order.push('readEpoch');
        return 4;
      });
      mocks.password.verify.mockImplementation(async () => {
        order.push('verify');
        return true;
      });

      await service.login(baseInput, '1.2.3.4', 'ua', req, res);

      // The ORDER is the fence. Reading the epoch after the verify would leave
      // the whole argon2 window open: a password change committing during it
      // would be beaten by this login, which read the pre-change hash.
      expect(order).toEqual(['readEpoch', 'verify']);
      expect(mocks.twoFactorChallenge.beginOrEstablish).toHaveBeenCalledWith(
        req,
        res,
        expect.anything(),
        expect.objectContaining({ epoch: 4 }),
      );
    });

    it('rememberMe: true is forwarded to the seam options and audit metadata', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture({ emailVerified: true }));
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      mocks.password.verify.mockResolvedValue(true);

      await service.login({ ...baseInput, rememberMe: true }, '1.2.3.4', 'ua', req, res);

      expect(mocks.twoFactorChallenge.beginOrEstablish).toHaveBeenCalledWith(
        req,
        res,
        expect.anything(),
        expect.objectContaining({ rememberMe: true }),
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { rememberMe: true } }),
      );
    });

    it('throws Turnstile error before any user lookup', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.shared.validateTurnstile.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: AppErrorCode.TURNSTILE_FAILED }),
      );

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
        message: AppErrorCode.TURNSTILE_FAILED,
      });
      expect(mocks.user.findCredentialByEmail).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('OWASP enumeration guard: unknown email throws generic UNAUTHORIZED with "Invalid email or password" and audits unknown_email', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(null);

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        appCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      // Audited as failure with reason: 'unknown_email' and NO userId.
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
          success: false,
          metadata: { reason: 'unknown_email' },
        }),
      );
      const auditCall = mocks.audit.log.mock.calls[0][0];
      expect(auditCall.userId).toBeUndefined();
    });

    it('timing oracle guard: unknown email still pays a dummy argon2 verify before throwing', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(null);

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      // The dummy verify equalizes the unknown-email and bad-password branches
      // so the response time cannot reveal whether the email exists.
      expect(mocks.password.verify).toHaveBeenCalledWith(
        TIMING_EQUALIZATION_HASH,
        baseInput.password,
      );
    });

    it('OWASP enumeration guard: bad password produces IDENTICAL error message as unknown email', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture());
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      mocks.password.verify.mockResolvedValue(false);
      mocks.lockout.recordFailedAttempt.mockResolvedValue({ locked: false, attemptsRemaining: 4 });

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        appCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      expect(mocks.lockout.recordFailedAttempt).toHaveBeenCalledWith('user-1');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
          userId: 'user-1',
          success: false,
          metadata: { reason: 'bad_password' },
        }),
      );
    });

    it('rejects an account with no password (null passwordHash) exactly like a wrong password', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(
        userFixture({ id: 'nopw-1', passwordHash: null }),
      );
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      // Deliberately "correct": a null hash must fail even if the verify mock
      // would say yes, because nothing may be verified against.
      mocks.password.verify.mockResolvedValue(true);
      mocks.lockout.recordFailedAttempt.mockResolvedValue({ locked: false, attemptsRemaining: 4 });

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
        // Byte-identical to the wrong-password rejection: no appCode, no
        // message and no HTTP code that could single out an account with no password.
        code: 'UNAUTHORIZED',
        appCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      // Never establishes a session: a null hash is not a bypass.
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
      expect(mocks.twoFactorChallenge.beginOrEstablish).not.toHaveBeenCalled();
      // Burns the same argon2 cost a real credential check pays, against the
      // dummy hash, so response time does not reveal the account has no password.
      expect(mocks.password.verify).toHaveBeenCalledWith(
        TIMING_EQUALIZATION_HASH,
        baseInput.password,
      );
      expect(mocks.password.verify).toHaveBeenCalledTimes(1);
      // Same lockout accounting too: an account with no password that never locked
      // would itself be an oracle.
      expect(mocks.lockout.recordFailedAttempt).toHaveBeenCalledWith('nopw-1');
      // The audit row (server-side only) still distinguishes the two, so
      // operators can tell a typo from an account with no password.
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
          userId: 'nopw-1',
          success: false,
          metadata: { reason: 'no_password_set' },
        }),
      );
    });

    it('throws FORBIDDEN/ACCOUNT_LOCKED and audits AUTH_LOGIN_LOCKED when account is locked', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(
        userFixture({ id: 'u-7', lockedUntil: new Date(Date.now() + 60_000) }),
      );
      mocks.lockout.isLockedFromUser.mockReturnValue({
        locked: true,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: AppErrorCode.ACCOUNT_LOCKED,
      });
      expect(mocks.password.verify).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_LOGIN_LOCKED,
          userId: 'u-7',
          success: false,
        }),
      );
    });

    it('reserves the attempt BEFORE argon2, not after the verify', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture({ id: 'u-1' }));
      const order: string[] = [];
      mocks.lockout.reserveAttempt.mockImplementation(async () => {
        order.push('reserve');
        return { withinBudget: true };
      });
      mocks.password.verify.mockImplementation(async () => {
        order.push('verify');
        return true;
      });

      await service.login(baseInput, '1.2.3.4', 'ua', req, res);

      // The ORDER is the whole fix. Counting after the verify meant every
      // request that started before the fifth failure committed got a full
      // argon2 evaluation, so the 5-attempt budget bounded nothing but the
      // number of requests in flight during one argon2 window.
      expect(order).toEqual(['reserve', 'verify']);
      expect(mocks.lockout.reserveAttempt).toHaveBeenCalledWith('u-1');
    });

    it('refuses an over-budget attempt through the existing ACCOUNT_LOCKED path, without argon2', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture({ id: 'u-7' }));
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      mocks.lockout.reserveAttempt.mockResolvedValue({ withinBudget: false });

      // Byte-identical to a real lockout on the wire: no new error code, and
      // nothing that says whether the row or the counter refused.
      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: AppErrorCode.ACCOUNT_LOCKED,
      });
      expect(mocks.password.verify).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_LOGIN_LOCKED,
          userId: 'u-7',
          success: false,
          // Server-side only: audit rows never reach the client, so an operator
          // can still tell a burst from an ordinary lockout.
          metadata: { reason: 'attempt_budget' },
        }),
      );
    });

    it('never reserves for an account the row already says is locked', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture({ id: 'u-7' }));
      mocks.lockout.isLockedFromUser.mockReturnValue({
        locked: true,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toThrow();

      // Or a locked account would inflate its own counter for the whole window
      // and stay refused past the tier it was actually given.
      expect(mocks.lockout.reserveAttempt).not.toHaveBeenCalled();
    });

    it('reserves for an account with no password too, so a burst cannot tell it apart', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(
        userFixture({ id: 'nopw-1', passwordHash: null }),
      );
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      mocks.lockout.recordFailedAttempt.mockResolvedValue({ locked: false, attemptsRemaining: 4 });

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toThrow();

      // The reservation happens before the passwordHash is even looked at, so a
      // passwordless account cannot be identified by being the one that never
      // hits the budget.
      expect(mocks.lockout.reserveAttempt).toHaveBeenCalledWith('nopw-1');
    });

    it('does not reserve on the unknown-email branch (no account to reserve against)', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(null);

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toThrow();

      expect(mocks.lockout.reserveAttempt).not.toHaveBeenCalled();
    });

    it('does not call resetAttempts when password verify fails', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture());
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
      mocks.password.verify.mockResolvedValue(false);
      mocks.lockout.recordFailedAttempt.mockResolvedValue({ locked: false, attemptsRemaining: 4 });

      await expect(service.login(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toBeDefined();
      expect(mocks.lockout.resetAttempts).not.toHaveBeenCalled();
      expect(mocks.twoFactorChallenge.beginOrEstablish).not.toHaveBeenCalled();
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
    });
  });

  describe('logout()', () => {
    it('deletes session, clears cookie, rotates CSRF, audits AUTH_LOGOUT', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      mocks.session.deleteSession.mockResolvedValue('sid-1');

      await service.logout('sess-tok', req, res);

      expect(mocks.session.deleteSession).toHaveBeenCalledWith('sess-tok');
      expect(mocks.shared.clearSessionCookie).toHaveBeenCalledWith(res);
      expect(mocks.csrf.rotate).toHaveBeenCalledWith(req, res);
      expect(mocks.audit.log).toHaveBeenCalledWith({ action: AUDIT_ACTIONS.AUTH_LOGOUT });
    });
  });

  describe('logoutAll()', () => {
    it('revokes all sessions for user, clears cookie, rotates CSRF, audits with userId', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();

      await service.logoutAll('u-1', req, res);

      expect(mocks.session.deleteAllUserSessions).toHaveBeenCalledWith('u-1');
      expect(mocks.shared.clearSessionCookie).toHaveBeenCalledWith(res);
      expect(mocks.csrf.rotate).toHaveBeenCalledWith(req, res);
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_LOGOUT_ALL,
          userId: 'u-1',
          targetType: 'User',
          targetId: 'u-1',
        }),
      );
    });
  });

  describe('TIMING_EQUALIZATION_HASH', () => {
    it('encodes the same argon2id m/t/p parameters as ARGON2_OPTIONS', () => {
      // A cost bump in ARGON2_OPTIONS without regenerating the dummy hash would
      // silently break the timing guarantee: the unknown-email branch would keep
      // paying the OLD verify cost while real credentials pay the new one.
      const match = TIMING_EQUALIZATION_HASH.match(/^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/);
      expect(match).not.toBeNull();
      const [, m, t, p] = match as RegExpMatchArray;
      expect(Number(m)).toBe(ARGON2_OPTIONS.memoryCost);
      expect(Number(t)).toBe(ARGON2_OPTIONS.timeCost);
      expect(Number(p)).toBe(ARGON2_OPTIONS.parallelism);
    });
  });
});

/**
 * Login is where a removed member is refused, and where a healthy one gets a
 * session. The refusal must look like any other credential failure.
 */
describe('LoginService: the disabled-account fence', () => {
  const baseInput = {
    email: 'jane@example.com',
    password: 'CorrectHorseBatteryStaple1!',
    rememberMe: false,
    turnstileToken: 'tok',
  };

  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [LoginService] });
    return { ...ctx, service: ctx.get(LoginService) };
  };

  const authenticateAs = (
    mocks: Awaited<ReturnType<typeof buildCtx>>['mocks'],
    over: Record<string, unknown> = {},
  ) => {
    mocks.user.findCredentialByEmail.mockResolvedValue(
      userFixture({ id: 'u-member', emailVerified: true, ...over }),
    );
    mocks.lockout.isLockedFromUser.mockReturnValue({ locked: false });
    mocks.password.verify.mockResolvedValue(true);
    mocks.lockout.resetAttempts.mockResolvedValue(undefined);
  };

  it('lets a healthy login through untouched', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    authenticateAs(mocks, { id: 'u-healthy', role: 'USER' });

    const result = await service.login(baseInput, '127.0.0.1', 'ua', req, res);

    expect(result.status).toBe('ok');
  });

  describe('the disabled-account fence', () => {
    it('refuses a disabled account, with the generic credential error', async () => {
      // A disabled account must be indistinguishable from a wrong password to
      // anyone who does not hold the password, or this becomes an oracle for
      // which accounts an admin disabled.
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      authenticateAs(mocks, {
        id: 'u-left',
        role: 'USER',
        disabledAt: new Date('2026-05-01T00:00:00Z'),
      });

      await expect(service.login(baseInput, '127.0.0.1', 'ua', req, res)).rejects.toThrow(
        'Invalid email or password',
      );
      expect(mocks.twoFactorChallenge.beginOrEstablish).not.toHaveBeenCalled();
    });

    it('runs the check AFTER the credential verify, not before it', async () => {
      // Refusing early would answer faster for a disabled account than for a wrong
      // password, which is the timing half of the same oracle.
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      authenticateAs(mocks, {
        id: 'u-left',
        disabledAt: new Date('2026-05-01T00:00:00Z'),
      });

      await expect(service.login(baseInput, '127.0.0.1', 'ua', req, res)).rejects.toThrow();
      expect(mocks.password.verify).toHaveBeenCalled();
    });

    it('records the real reason server-side even though the client is told nothing', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();
      authenticateAs(mocks, {
        id: 'u-left',
        disabledAt: new Date('2026-05-01T00:00:00Z'),
      });

      await expect(service.login(baseInput, '127.0.0.1', 'ua', req, res)).rejects.toThrow();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'account_disabled' }),
        }),
      );
    });
  });
});
