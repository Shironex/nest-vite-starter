import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { StepUpService } from './step-up.service';
import { createAuthTestModule } from '@test/test-module';

/**
 * The gate three flows delegate to. Each flow's own spec still asserts that it
 * CALLS the gate with its own context; this file owns the sequence itself.
 */
describe('StepUpService', () => {
  const buildCtx = async () => {
    const ctx = await createAuthTestModule();
    return { ...ctx, service: ctx.get(StepUpService) };
  };

  const withActiveFactor = (mocks: Awaited<ReturnType<typeof buildCtx>>['mocks']) => {
    mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });
    mocks.secondFactor.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
  };

  describe('assertSecondFactor', () => {
    it('is inert for an account with no active non-recovery factor', async () => {
      const { service, mocks } = await buildCtx();

      await expect(
        service.assertSecondFactor({ userId: 'u-1', code: undefined, ip: '1.2.3.4', context: 'x' }),
      ).resolves.toBeUndefined();

      // Not even the rate limit is spent: an account that cannot be challenged
      // must not be able to exhaust a budget it never uses.
      expect(mocks.shared.enforceRateLimit).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('spends the shared manage budget before verifying, so guessing is bounded', async () => {
      const { service, mocks } = await buildCtx();
      withActiveFactor(mocks);
      mocks.totp.verify.mockResolvedValue(true);

      await service.assertSecondFactor({
        userId: 'u-1',
        code: '123456',
        ip: '1.2.3.4',
        context: 'email_change',
      });

      expect(mocks.shared.enforceRateLimit).toHaveBeenCalledWith('2fa-manage:u-1', 5, 300);
    });

    it('refuses a missing code without giving the caller a way to skip the gate', async () => {
      const { service, mocks } = await buildCtx();
      withActiveFactor(mocks);

      await expect(
        service.assertSecondFactor({
          userId: 'u-1',
          code: undefined,
          ip: '1.2.3.4',
          context: 'password_reset',
        }),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE });

      expect(mocks.totp.verify).not.toHaveBeenCalled();
    });

    it('audits the refusal with the calling flow as context', async () => {
      const { service, mocks } = await buildCtx();
      withActiveFactor(mocks);
      mocks.totp.verify.mockResolvedValue(false);

      await expect(
        service.assertSecondFactor({
          userId: 'u-1',
          code: '000000',
          ip: '1.2.3.4',
          context: 'email_change',
        }),
      ).rejects.toBeDefined();

      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_FAILURE,
          userId: 'u-1',
          success: false,
          ipAddress: '1.2.3.4',
          metadata: { reason: 'bad_code', context: 'email_change' },
        }),
      );
    });

    it('stamps the tenant when the caller has one, for the unauthenticated flows', async () => {
      const { service, mocks } = await buildCtx();
      withActiveFactor(mocks);
      mocks.totp.verify.mockResolvedValue(false);

      await expect(
        service.assertSecondFactor({
          userId: 'u-1',
          code: '000000',
          ip: '1.2.3.4',
          context: 'password_reset',
          tenantId: 't-1',
        }),
      ).rejects.toBeDefined();

      expect(mocks.audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1' }));
    });

    it('calls onRefused once, before the throw, for a flow that also counts refusals', async () => {
      const { service, mocks } = await buildCtx();
      withActiveFactor(mocks);
      mocks.totp.verify.mockResolvedValue(false);
      const onRefused = jest.fn();

      await expect(
        service.assertSecondFactor({
          userId: 'u-1',
          code: '000000',
          ip: '1.2.3.4',
          context: 'password_reset',
          onRefused,
        }),
      ).rejects.toBeDefined();

      expect(onRefused).toHaveBeenCalledTimes(1);
    });

    it('does not call onRefused when the code is good', async () => {
      const { service, mocks } = await buildCtx();
      withActiveFactor(mocks);
      mocks.totp.verify.mockResolvedValue(true);
      const onRefused = jest.fn();

      await service.assertSecondFactor({
        userId: 'u-1',
        code: '123456',
        ip: '1.2.3.4',
        context: 'password_reset',
        onRefused,
      });

      expect(onRefused).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });
  });

  describe('verifyCode', () => {
    it('verifies a TOTP against the active secret', async () => {
      const { service, mocks } = await buildCtx();
      mocks.secondFactor.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      mocks.totp.verify.mockResolvedValue(true);

      await expect(service.verifyCode('u-1', '123456')).resolves.toBe('totp');
    });

    it('strips internal whitespace from a pasted TOTP', async () => {
      const { service, mocks } = await buildCtx();
      mocks.secondFactor.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      mocks.totp.verify.mockResolvedValue(true);

      await service.verifyCode('u-1', '123 456');

      expect(mocks.totp.verify).toHaveBeenCalledWith('u-1', 'enc', '123456');
    });

    it('redeems a recovery code atomically', async () => {
      const { service, mocks } = await buildCtx();
      mocks.secondFactor.redeemRecoveryCode.mockResolvedValue(true);

      await expect(service.verifyCode('u-1', 'ABCD-EFGH-JKMN-PQRS')).resolves.toBe('recovery');
    });

    it('answers null for a code that matches neither shape', async () => {
      const { service, mocks } = await buildCtx();

      // A caller must never be able to tell "wrong code" from "not a code":
      // the shape itself is information about which factors are enrolled.
      await expect(service.verifyCode('u-1', 'nonsense')).resolves.toBeNull();
      expect(mocks.totp.verify).not.toHaveBeenCalled();
      expect(mocks.secondFactor.redeemRecoveryCode).not.toHaveBeenCalled();
    });

    it('answers null when the account has no active TOTP row to verify against', async () => {
      const { service, mocks } = await buildCtx();
      mocks.secondFactor.findActiveTotp.mockResolvedValue(null);

      await expect(service.verifyCode('u-1', '123456')).resolves.toBeNull();
      expect(mocks.totp.verify).not.toHaveBeenCalled();
    });
  });
});
