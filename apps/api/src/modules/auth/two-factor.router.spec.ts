import { TwoFactorRouter } from './two-factor.router';
import { expressMocks } from '../../../test/fixtures';
import type { Request } from 'express';

type Services = ConstructorParameters<typeof TwoFactorRouter>;

const buildRouter = () => {
  const twoFactorService = {
    status: jest.fn().mockResolvedValue({ enabled: false }),
    beginEnrollment: jest.fn().mockResolvedValue({ otpauthUri: 'otpauth://x', secretBase32: 'S' }),
    activate: jest.fn().mockResolvedValue({ recoveryCodes: ['A', 'B'] }),
    disable: jest.fn().mockResolvedValue(undefined),
    regenerateRecoveryCodes: jest.fn().mockResolvedValue({ recoveryCodes: ['C'] }),
    revokeTrustedDevices: jest.fn().mockResolvedValue(undefined),
  };
  const adminResetService = {
    resetUserTwoFactor: jest.fn().mockResolvedValue(undefined),
  };
  const router = new TwoFactorRouter(
    twoFactorService as unknown as Services[0],
    adminResetService as unknown as Services[1],
  );
  return { router, twoFactorService, adminResetService };
};

const buildCtx = (ip = '1.2.3.4', ua = 'jest-ua') => {
  const { req, res } = expressMocks({ headers: { 'user-agent': ua } });
  (req as Request & { ip: string }).ip = ip;
  return { req, res, ctx: { req, res, user: { id: 'u-1' } } };
};

describe('TwoFactorRouter (wiring)', () => {
  it('status delegates to the service with the caller id', async () => {
    const { router, twoFactorService } = buildRouter();
    const { ctx } = buildCtx();
    await router.status(ctx as unknown as Parameters<typeof router.status>[0]);
    expect(twoFactorService.status).toHaveBeenCalledWith('u-1');
  });

  it('beginEnrollment passes userId + password + ip/ua and returns the setup payload', async () => {
    const { router, twoFactorService } = buildRouter();
    const { ctx } = buildCtx('9.9.9.9', 'ua-x');
    const result = await router.beginEnrollment(
      { password: 'pw' },
      ctx as unknown as Parameters<typeof router.beginEnrollment>[1],
    );
    expect(twoFactorService.beginEnrollment).toHaveBeenCalledWith('u-1', 'pw', '9.9.9.9', 'ua-x');
    expect(result).toEqual({ otpauthUri: 'otpauth://x', secretBase32: 'S' });
  });

  it('activate passes userId + code + ip/ua and returns recovery codes', async () => {
    const { router, twoFactorService } = buildRouter();
    const { ctx } = buildCtx();
    const result = await router.activate(
      { code: '123456' },
      ctx as unknown as Parameters<typeof router.activate>[1],
    );
    expect(twoFactorService.activate).toHaveBeenCalledWith('u-1', '123456', '1.2.3.4', 'jest-ua');
    expect(result).toEqual({ recoveryCodes: ['A', 'B'] });
  });

  it('disable passes password + code and returns { success: true }', async () => {
    const { router, twoFactorService } = buildRouter();
    const { ctx } = buildCtx();
    const result = await router.disable(
      { password: 'pw', code: '123456' },
      ctx as unknown as Parameters<typeof router.disable>[1],
    );
    expect(twoFactorService.disable).toHaveBeenCalledWith(
      'u-1',
      'pw',
      '123456',
      '1.2.3.4',
      'jest-ua',
    );
    expect(result).toEqual({ success: true });
  });

  it('regenerateRecoveryCodes passes the password and returns codes', async () => {
    const { router, twoFactorService } = buildRouter();
    const { ctx } = buildCtx();
    const result = await router.regenerateRecoveryCodes(
      { password: 'pw' },
      ctx as unknown as Parameters<typeof router.regenerateRecoveryCodes>[1],
    );
    expect(twoFactorService.regenerateRecoveryCodes).toHaveBeenCalledWith(
      'u-1',
      'pw',
      '1.2.3.4',
      'jest-ua',
    );
    expect(result).toEqual({ recoveryCodes: ['C'] });
  });

  it('revokeTrustedDevices delegates and returns { success: true }', async () => {
    const { router, twoFactorService } = buildRouter();
    const { ctx } = buildCtx();
    const result = await router.revokeTrustedDevices(
      ctx as unknown as Parameters<typeof router.revokeTrustedDevices>[0],
    );
    expect(twoFactorService.revokeTrustedDevices).toHaveBeenCalledWith('u-1', '1.2.3.4', 'jest-ua');
    expect(result).toEqual({ success: true });
  });

  it('resetUserTwoFactor passes caller id, target id + ip/ua', async () => {
    const { router, adminResetService } = buildRouter();
    const { ctx } = buildCtx();
    const result = await router.resetUserTwoFactor(
      { userId: 'm1' },
      ctx as unknown as Parameters<typeof router.resetUserTwoFactor>[1],
    );
    expect(adminResetService.resetUserTwoFactor).toHaveBeenCalledWith(
      'u-1',
      'm1',
      '1.2.3.4',
      'jest-ua',
    );
    expect(result).toEqual({ success: true });
  });
});
