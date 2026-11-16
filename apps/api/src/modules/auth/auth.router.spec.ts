import { AppErrorCode } from '@repo/shared/errors';
import { AuthRouter } from './auth.router';
import { expressMocks } from '../../../test/fixtures';
import type { Request } from 'express';

type Services = ConstructorParameters<typeof AuthRouter>;

const buildRouter = () => {
  const registerService = { register: jest.fn().mockResolvedValue({ user: { id: 'u-1' } }) };
  const loginService = {
    login: jest.fn().mockResolvedValue({ user: { id: 'u-1' } }),
    logout: jest.fn().mockResolvedValue(undefined),
    logoutAll: jest.fn().mockResolvedValue(undefined),
  };
  const emailVerificationService = {
    verifyEmail: jest.fn().mockResolvedValue(undefined),
    resendVerification: jest.fn().mockResolvedValue(undefined),
  };
  const passwordResetService = {
    forgotPassword: jest.fn().mockResolvedValue(undefined),
    resetPassword: jest.fn().mockResolvedValue(undefined),
    getResetTokenState: jest.fn().mockResolvedValue({ valid: true, requiresTwoFactor: false }),
  };
  const passwordChangeService = {
    changePassword: jest.fn().mockResolvedValue(undefined),
  };
  const accountDeletionService = {
    deleteAccount: jest.fn().mockResolvedValue(undefined),
  };
  const twoFactorChallengeService = {
    verifyChallenge: jest.fn().mockResolvedValue({ status: 'ok', user: { id: 'u-1' } }),
  };
  const sudoService = {
    confirmPassword: jest.fn().mockResolvedValue(undefined),
    // Default: a live sudo grant, so the email-change happy path passes; the
    // FORBIDDEN branch opts out per spec.
    isActive: jest.fn().mockResolvedValue(true),
  };
  const emailChangeService = {
    requestEmailChange: jest.fn().mockResolvedValue(undefined),
    confirmEmailChange: jest.fn().mockResolvedValue(undefined),
  };

  const router = new AuthRouter(
    registerService as unknown as Services[0],
    loginService as unknown as Services[1],
    emailVerificationService as unknown as Services[2],
    passwordResetService as unknown as Services[3],
    passwordChangeService as unknown as Services[4],
    accountDeletionService as unknown as Services[5],
    twoFactorChallengeService as unknown as Services[6],
    sudoService as unknown as Services[7],
    emailChangeService as unknown as Services[8],
  );

  return {
    router,
    registerService,
    loginService,
    emailVerificationService,
    passwordResetService,
    passwordChangeService,
    accountDeletionService,
    twoFactorChallengeService,
    sudoService,
    emailChangeService,
  };
};

const buildCtx = (
  init: {
    headers?: Record<string, string>;
    ip?: string;
    user?: { id: string; email: string; role: string; emailVerified: boolean } | null;
    session?: { id: string; token: string } | null;
  } = {},
) => {
  const { req, res } = expressMocks({ headers: init.headers ?? { 'user-agent': 'jest-ua' } });
  // Inject ip: getClientIp reads req.ip first.
  (req as Request & { ip: string }).ip = init.ip ?? '127.0.0.1';
  (req as unknown as { socket: { remoteAddress: string } }).socket = {
    remoteAddress: '10.0.0.1',
  };
  return {
    req,
    res,
    ctx: {
      req,
      res,
      user: init.user ?? null,
      session: init.session ?? null,
    },
  };
};

describe('AuthRouter (wiring)', () => {
  describe('register', () => {
    it('extracts ip + user-agent and delegates to RegisterService', async () => {
      const { router, registerService } = buildRouter();
      const { ctx, req, res } = buildCtx({ headers: { 'user-agent': 'jest' }, ip: '1.2.3.4' });
      const input = { email: 'a@b.c', password: 'pw', turnstileToken: 't' };
      await router.register(
        input as unknown as Parameters<typeof router.register>[0],
        ctx as unknown as Parameters<typeof router.register>[1],
      );
      expect(registerService.register).toHaveBeenCalledWith(input, '1.2.3.4', 'jest', req, res);
    });

    it('falls back to "unknown" user-agent when header missing', async () => {
      const { router, registerService } = buildRouter();
      const { ctx } = buildCtx({ headers: {} });
      await router.register(
        {} as unknown as Parameters<typeof router.register>[0],
        ctx as unknown as Parameters<typeof router.register>[1],
      );
      expect(registerService.register).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        'unknown',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('login', () => {
    it('delegates to LoginService.login with ip/ua/req/res', async () => {
      const { router, loginService } = buildRouter();
      const { ctx, req, res } = buildCtx({ headers: { 'user-agent': 'ua' }, ip: '9.9.9.9' });
      const input = { email: 'e', password: 'p' };
      await router.login(
        input as unknown as Parameters<typeof router.login>[0],
        ctx as unknown as Parameters<typeof router.login>[1],
      );
      expect(loginService.login).toHaveBeenCalledWith(input, '9.9.9.9', 'ua', req, res);
    });
  });

  describe('verifyTwoFactor', () => {
    it('delegates to TwoFactorChallengeService.verifyChallenge with req/res/input/ip/ua', async () => {
      const { router, twoFactorChallengeService } = buildRouter();
      const { ctx, req, res } = buildCtx({ headers: { 'user-agent': 'ua' }, ip: '9.9.9.9' });
      const input = { code: '123456', trustDevice: true };
      await router.verifyTwoFactor(
        input as unknown as Parameters<typeof router.verifyTwoFactor>[0],
        ctx as unknown as Parameters<typeof router.verifyTwoFactor>[1],
      );
      expect(twoFactorChallengeService.verifyChallenge).toHaveBeenCalledWith(
        req,
        res,
        input,
        '9.9.9.9',
        'ua',
      );
    });
  });

  describe('forgotPassword', () => {
    it('delegates and returns { success: true }', async () => {
      const { router, passwordResetService } = buildRouter();
      const { ctx } = buildCtx({ ip: '1.1.1.1' });
      const result = await router.forgotPassword(
        { email: 'e@x.c', turnstileToken: 't' },
        ctx as unknown as Parameters<typeof router.forgotPassword>[1],
      );
      expect(passwordResetService.forgotPassword).toHaveBeenCalledWith('e@x.c', 't', '1.1.1.1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('resetPassword', () => {
    it('delegates with the client ip and returns { success: true }', async () => {
      const { router, passwordResetService } = buildRouter();
      const { ctx } = buildCtx({ ip: '1.1.1.1' });
      const result = await router.resetPassword(
        { token: 'tok', password: 'newpw' },
        ctx as unknown as Parameters<typeof router.resetPassword>[1],
      );
      expect(passwordResetService.resetPassword).toHaveBeenCalledWith(
        'tok',
        'newpw',
        '1.1.1.1',
        undefined,
      );
      expect(result).toEqual({ success: true });
    });

    it('forwards a factor code to resetPassword when present', async () => {
      const { router, passwordResetService } = buildRouter();
      const { ctx } = buildCtx({ ip: '1.1.1.1' });
      await router.resetPassword(
        { token: 'tok', password: 'newpw', factorCode: '123456' },
        ctx as unknown as Parameters<typeof router.resetPassword>[1],
      );
      expect(passwordResetService.resetPassword).toHaveBeenCalledWith(
        'tok',
        'newpw',
        '1.1.1.1',
        '123456',
      );
    });
  });

  describe('resetPasswordTokenState', () => {
    it('delegates to getResetTokenState and returns the flags', async () => {
      const { router, passwordResetService } = buildRouter();
      const { ctx } = buildCtx({ ip: '1.1.1.1' });
      passwordResetService.getResetTokenState.mockResolvedValue({
        valid: true,
        requiresTwoFactor: true,
      });
      const result = await router.resetPasswordTokenState(
        { token: 'tok' },
        ctx as unknown as Parameters<typeof router.resetPasswordTokenState>[1],
      );
      expect(passwordResetService.getResetTokenState).toHaveBeenCalledWith('tok', '1.1.1.1');
      expect(result).toEqual({ valid: true, requiresTwoFactor: true });
    });
  });

  describe('verifyEmail', () => {
    it('delegates with the client ip and returns { success: true }', async () => {
      const { router, emailVerificationService } = buildRouter();
      const { ctx } = buildCtx({ ip: '1.1.1.1' });
      const result = await router.verifyEmail(
        { token: 'verif' },
        ctx as unknown as Parameters<typeof router.verifyEmail>[1],
      );
      expect(emailVerificationService.verifyEmail).toHaveBeenCalledWith('verif', '1.1.1.1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('logout', () => {
    it('passes session.token + req/res to LoginService.logout', async () => {
      const { router, loginService } = buildRouter();
      const { ctx, req, res } = buildCtx({
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: true },
        session: { id: 'sid', token: 'tok' },
      });
      const result = await router.logout(ctx as unknown as Parameters<typeof router.logout>[0]);
      expect(loginService.logout).toHaveBeenCalledWith('tok', req, res);
      expect(result).toEqual({ success: true });
    });
  });

  describe('logoutAll', () => {
    it('passes user.id + req/res to LoginService.logoutAll', async () => {
      const { router, loginService } = buildRouter();
      const { ctx, req, res } = buildCtx({
        user: { id: 'u-7', email: 'e', role: 'USER', emailVerified: true },
        session: { id: 'sid', token: 'tok' },
      });
      const result = await router.logoutAll(
        ctx as unknown as Parameters<typeof router.logoutAll>[0],
      );
      expect(loginService.logoutAll).toHaveBeenCalledWith('u-7', req, res);
      expect(result).toEqual({ success: true });
    });
  });

  describe('resendVerification', () => {
    it('delegates with userId, turnstile token, and ip', async () => {
      const { router, emailVerificationService } = buildRouter();
      const { ctx } = buildCtx({
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: false },
        ip: '8.8.8.8',
      });
      const result = await router.resendVerification(
        { turnstileToken: 'cf-token' },
        ctx as unknown as Parameters<typeof router.resendVerification>[1],
      );
      expect(emailVerificationService.resendVerification).toHaveBeenCalledWith(
        'u-1',
        'cf-token',
        '8.8.8.8',
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('requestEmailChange', () => {
    it('refuses without a live sudo grant (FORBIDDEN = re-prompt the password dialog)', async () => {
      const { router, emailChangeService, sudoService } = buildRouter();
      sudoService.isActive.mockResolvedValue(false);
      const { ctx } = buildCtx({
        user: { id: 'u-1', email: 'old@x.com', role: 'USER', emailVerified: true },
        session: { id: 'sid-1', token: 'tok' },
      });
      await expect(
        router.requestEmailChange(
          { newEmail: 'new@x.com' },
          ctx as unknown as Parameters<typeof router.requestEmailChange>[1],
        ),
      ).rejects.toMatchObject({ appCode: AppErrorCode.FORBIDDEN });
      expect(sudoService.isActive).toHaveBeenCalledWith('sid-1');
      expect(emailChangeService.requestEmailChange).not.toHaveBeenCalled();
    });

    it('with sudo active, delegates userId, newEmail, factorCode, ip, ua', async () => {
      const { router, emailChangeService } = buildRouter();
      const { ctx } = buildCtx({
        user: { id: 'u-1', email: 'old@x.com', role: 'USER', emailVerified: true },
        session: { id: 'sid-1', token: 'tok' },
        ip: '5.5.5.5',
        headers: { 'user-agent': 'ua-x' },
      });
      const result = await router.requestEmailChange(
        { newEmail: 'new@x.com', factorCode: '123456' },
        ctx as unknown as Parameters<typeof router.requestEmailChange>[1],
      );
      expect(emailChangeService.requestEmailChange).toHaveBeenCalledWith(
        'u-1',
        'new@x.com',
        '123456',
        '5.5.5.5',
        'ua-x',
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('confirmEmailChange', () => {
    it('delegates token + ip (public procedure, token is the credential)', async () => {
      const { router, emailChangeService } = buildRouter();
      const { ctx } = buildCtx({ ip: '6.6.6.6' });
      const result = await router.confirmEmailChange(
        { token: 'raw-token' },
        ctx as unknown as Parameters<typeof router.confirmEmailChange>[1],
      );
      expect(emailChangeService.confirmEmailChange).toHaveBeenCalledWith('raw-token', '6.6.6.6');
      expect(result).toEqual({ success: true });
    });
  });

  describe('changePassword', () => {
    it('passes userId, current/new pw, ip, ua, req, res', async () => {
      const { router, passwordChangeService } = buildRouter();
      const { ctx, req, res } = buildCtx({
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: true },
        ip: '5.5.5.5',
        headers: { 'user-agent': 'ua-x' },
      });
      const result = await router.changePassword(
        { currentPassword: 'old', newPassword: 'new' },
        ctx as unknown as Parameters<typeof router.changePassword>[1],
      );
      expect(passwordChangeService.changePassword).toHaveBeenCalledWith(
        'u-1',
        'old',
        'new',
        '5.5.5.5',
        'ua-x',
        req,
        res,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('deleteAccount', () => {
    it('passes userId, password, ip, ua, req, res and returns { deleted: true }', async () => {
      const { router, accountDeletionService } = buildRouter();
      const { ctx, req, res } = buildCtx({
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: true },
        ip: '5.5.5.5',
        headers: { 'user-agent': 'ua-x' },
      });
      const result = await router.deleteAccount(
        { password: 'pw' },
        ctx as unknown as Parameters<typeof router.deleteAccount>[1],
      );
      expect(accountDeletionService.deleteAccount).toHaveBeenCalledWith(
        'u-1',
        'pw',
        '5.5.5.5',
        'ua-x',
        req,
        res,
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('confirmPassword', () => {
    it('grants sudo to THIS session: passes userId, sessionId and the password', async () => {
      const { router, sudoService } = buildRouter();
      const { ctx } = buildCtx({
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: true },
        session: { id: 'sess-1', token: 'raw-token' },
      });
      const result = await router.confirmPassword(
        { password: 'pw' },
        ctx as unknown as Parameters<typeof router.confirmPassword>[1],
      );
      expect(sudoService.confirmPassword).toHaveBeenCalledWith('u-1', 'sess-1', 'pw');
      expect(result).toEqual({ success: true });
    });

    it('propagates the service rejection (wrong password never acks)', async () => {
      const { router, sudoService } = buildRouter();
      sudoService.confirmPassword.mockRejectedValue(new Error('INVALID_CREDENTIALS'));
      const { ctx } = buildCtx({
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: true },
        session: { id: 'sess-1', token: 'raw-token' },
      });
      await expect(
        router.confirmPassword(
          { password: 'nope' },
          ctx as unknown as Parameters<typeof router.confirmPassword>[1],
        ),
      ).rejects.toThrow('INVALID_CREDENTIALS');
    });
  });
});
