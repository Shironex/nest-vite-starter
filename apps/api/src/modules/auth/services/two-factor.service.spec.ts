import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { TwoFactorService } from './two-factor.service';
import { TotpService } from './totp.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import { RECOVERY_CODE_COUNT } from '../auth.constants';
import { createAuthTestModule } from '@test/test-module';
import { userFixture } from '@test/fixtures';

type RepoMock = Record<keyof SecondFactorRepository, jest.Mock>;

describe('TwoFactorService', () => {
  const buildCtx = async () => {
    const repo = {
      findActiveNonRecovery: jest.fn(),
      findActiveTotp: jest.fn(),
      findPendingTotp: jest.fn(),
      deletePendingTotp: jest.fn().mockResolvedValue(undefined),
      createPendingTotp: jest.fn().mockResolvedValue({ id: 'pending-1' }),
      activateTotp: jest.fn().mockResolvedValue(1),
      createRecoveryCodes: jest.fn().mockResolvedValue({ count: RECOVERY_CODE_COUNT }),
      deleteRecoveryCodes: jest.fn().mockResolvedValue({ count: 0 }),
      deleteAllForUser: jest.fn().mockResolvedValue({ count: 1 }),
      countUnusedRecoveryCodes: jest.fn().mockResolvedValue(0),
      redeemRecoveryCode: jest.fn(),
      touchLastUsed: jest.fn(),
    } as unknown as RepoMock;

    const totp = {
      generateSecret: jest
        .fn()
        .mockReturnValue({ secretBase32: 'SECRET', otpauthUri: 'otpauth://x' }),
      encryptSecret: jest.fn().mockReturnValue('enc'),
      verify: jest.fn(),
    };

    const ctx = await createAuthTestModule({
      providers: [
        TwoFactorService,
        { provide: SecondFactorRepository, useValue: repo },
        { provide: TotpService, useValue: totp },
      ],
    });
    return { ...ctx, service: ctx.get(TwoFactorService), repo, totp };
  };

  describe('beginEnrollment', () => {
    it('provisions a secret, replaces any pending row, and audits', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));
      mocks.password.verify.mockResolvedValue(true);
      repo.findActiveTotp.mockResolvedValue(null);

      const result = await service.beginEnrollment('u-1', 'pw', 'ip', 'ua');

      expect(result).toEqual({ otpauthUri: 'otpauth://x', secretBase32: 'SECRET' });
      expect(totp.generateSecret).toHaveBeenCalledWith('a@b.c');
      expect(repo.deletePendingTotp).toHaveBeenCalledWith('u-1', expect.anything());
      expect(repo.createPendingTotp).toHaveBeenCalledWith(
        { userId: 'u-1', totpSecretEnc: 'enc' },
        expect.anything(),
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_ENROLL_BEGIN, userId: 'u-1' }),
      );
    });

    it('rejects a wrong password (sudo gate) before provisioning', async () => {
      const { service, mocks, repo } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(false);

      await expect(service.beginEnrollment('u-1', 'bad', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.INVALID_CREDENTIALS,
      });
      expect(repo.createPendingTotp).not.toHaveBeenCalled();
    });

    it('refuses the sudo gate for an OAuth-only account (null passwordHash)', async () => {
      const { service, mocks, repo } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(
        userFixture({ id: 'u-1', passwordHash: null }),
      );
      // Would pass if it were ever reached. A hijacked session must not be able
      // to enroll a factor with no proof at all, so this fails CLOSED.
      mocks.password.verify.mockResolvedValue(true);

      await expect(service.beginEnrollment('u-1', 'anything', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.PASSWORD_NOT_SET,
      });
      expect(mocks.password.verify).not.toHaveBeenCalled();
      expect(repo.createPendingTotp).not.toHaveBeenCalled();
    });

    it('refuses when an ACTIVE TOTP factor already exists', async () => {
      const { service, mocks, repo } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(true);
      repo.findActiveTotp.mockResolvedValue({ id: 'existing' });

      await expect(service.beginEnrollment('u-1', 'pw', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.ALREADY_EXISTS,
      });
      expect(repo.deletePendingTotp).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('flips PENDING to ACTIVE and mints recovery codes in one transaction', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      repo.findPendingTotp.mockResolvedValue({
        id: 'pending-1',
        totpSecretEnc: 'enc',
        createdAt: new Date(),
      });
      totp.verify.mockResolvedValue(true);
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));

      const result = await service.activate('u-1', '123456', 'ip', 'ua');

      expect(result.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(result.recoveryCodes[0]).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(mocks.prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(repo.activateTotp).toHaveBeenCalled();
      expect(repo.createRecoveryCodes).toHaveBeenCalledWith(
        'u-1',
        expect.arrayContaining([expect.any(String)]),
        expect.anything(),
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_ENABLED }),
      );
      // The owner is notified their account gained a second factor.
      expect(mocks.mail.sendTwoFactorEnabledEmail).toHaveBeenCalledWith('a@b.c');
    });

    it('mints the codes even if the enabled-email notification fails (best-effort)', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      repo.findPendingTotp.mockResolvedValue({
        id: 'pending-1',
        totpSecretEnc: 'enc',
        createdAt: new Date(),
      });
      totp.verify.mockResolvedValue(true);
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));
      mocks.mail.sendTwoFactorEnabledEmail.mockRejectedValue(new Error('redis down'));

      const result = await service.activate('u-1', '123456', 'ip', 'ua');

      expect(result.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    });

    it('rejects a bad confirming code with TWO_FACTOR_INVALID_CODE and no writes', async () => {
      const { service, repo, totp } = await buildCtx();
      repo.findPendingTotp.mockResolvedValue({
        id: 'p',
        totpSecretEnc: 'enc',
        createdAt: new Date(),
      });
      totp.verify.mockResolvedValue(false);

      await expect(service.activate('u-1', '000000', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE,
      });
      expect(repo.activateTotp).not.toHaveBeenCalled();
    });

    it('rejects (and clears) a PENDING row older than one hour', async () => {
      const { service, repo, totp } = await buildCtx();
      repo.findPendingTotp.mockResolvedValue({
        id: 'p',
        totpSecretEnc: 'enc',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });

      await expect(service.activate('u-1', '123456', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.VALIDATION_ERROR,
      });
      expect(repo.deletePendingTotp).toHaveBeenCalledWith('u-1');
      expect(totp.verify).not.toHaveBeenCalled();
    });

    it('rejects when there is no pending enrollment', async () => {
      const { service, repo } = await buildCtx();
      repo.findPendingTotp.mockResolvedValue(null);
      await expect(service.activate('u-1', '123456', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.VALIDATION_ERROR,
      });
    });

    it('aborts without minting codes when the pending row was already activated (CAS)', async () => {
      const { service, repo, totp } = await buildCtx();
      repo.findPendingTotp.mockResolvedValue({
        id: 'p',
        totpSecretEnc: 'enc',
        createdAt: new Date(),
      });
      totp.verify.mockResolvedValue(true);
      // A concurrent activate already flipped the row: the CAS matches 0.
      repo.activateTotp.mockResolvedValue(0);

      await expect(service.activate('u-1', '123456', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.VALIDATION_ERROR,
      });
      expect(repo.createRecoveryCodes).not.toHaveBeenCalled();
    });

    it('maps a duplicate-active-TOTP unique violation to ALREADY_EXISTS', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      repo.findPendingTotp.mockResolvedValue({
        id: 'p',
        totpSecretEnc: 'enc',
        createdAt: new Date(),
      });
      totp.verify.mockResolvedValue(true);
      // The partial unique index rejects a second ACTIVE TOTP (racing tab).
      mocks.prisma.client.$transaction.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(service.activate('u-1', '123456', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.ALREADY_EXISTS,
      });
    });
  });

  describe('disable', () => {
    it('requires password AND a valid code, then deletes all factors, audits and mails', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));
      mocks.password.verify.mockResolvedValue(true);
      repo.findActiveTotp.mockResolvedValue({ id: 'f', totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(true);

      await service.disable('u-1', 'pw', '123456', 'ip', 'ua');

      expect(repo.deleteAllForUser).toHaveBeenCalledWith('u-1');
      // Trusted devices are forgotten too (the trust assertion is meaningless
      // once 2FA is gone).
      expect(mocks.trustedDevice.revokeAll).toHaveBeenCalledWith('u-1');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_DISABLED }),
      );
      expect(mocks.mail.sendTwoFactorDisabledEmail).toHaveBeenCalledWith('a@b.c');
    });

    it('rejects a wrong password before checking the code', async () => {
      const { service, mocks, repo } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(false);

      await expect(service.disable('u-1', 'bad', '123456', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.INVALID_CREDENTIALS,
      });
      expect(repo.deleteAllForUser).not.toHaveBeenCalled();
    });

    it('rejects a wrong code (correct password) and keeps factors', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(true);
      repo.findActiveTotp.mockResolvedValue({ id: 'f', totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(false);

      await expect(service.disable('u-1', 'pw', '000000', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE,
      });
      expect(repo.deleteAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('regenerateRecoveryCodes', () => {
    it('replaces all codes transactionally and returns fresh ones', async () => {
      const { service, mocks, repo } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(true);
      repo.findActiveTotp.mockResolvedValue({ id: 'f' });

      const result = await service.regenerateRecoveryCodes('u-1', 'pw', 'ip', 'ua');

      expect(result.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(repo.deleteRecoveryCodes).toHaveBeenCalled();
      expect(repo.createRecoveryCodes).toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_RECOVERY_REGENERATED }),
      );
    });

    it('rejects when 2FA is not enabled', async () => {
      const { service, mocks, repo } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(true);
      repo.findActiveTotp.mockResolvedValue(null);

      await expect(service.regenerateRecoveryCodes('u-1', 'pw', 'ip', 'ua')).rejects.toMatchObject({
        appCode: AppErrorCode.VALIDATION_ERROR,
      });
      expect(repo.createRecoveryCodes).not.toHaveBeenCalled();
    });
  });

  describe('revokeTrustedDevices', () => {
    it('revokes all trusted devices and audits', async () => {
      const { service, mocks } = await buildCtx();
      await service.revokeTrustedDevices('u-1', 'ip', 'ua');
      expect(mocks.trustedDevice.revokeAll).toHaveBeenCalledWith('u-1');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_TRUST_REVOKED }),
      );
    });
  });

  describe('status', () => {
    it('derives enabled + low-codes flag; policy/trusted are Step 4/5 placeholders', async () => {
      const { service, repo } = await buildCtx();
      repo.findActiveNonRecovery.mockResolvedValue({ type: 'TOTP' });
      repo.findPendingTotp.mockResolvedValue(null);
      repo.countUnusedRecoveryCodes.mockResolvedValue(2);

      const status = await service.status('u-1');
      expect(status).toEqual({
        enabled: true,
        methods: ['TOTP'],
        recoveryCodesRemaining: 2,
        lowRecoveryCodes: true,
        pendingEnrollment: false,
        trustedDeviceCount: 0,
        policy: { required: false, graceEndsAt: null, enforced: false },
      });
    });

    it('reports disabled with no methods and not-low when no factor exists', async () => {
      const { service, repo } = await buildCtx();
      repo.findActiveNonRecovery.mockResolvedValue(null);
      repo.findPendingTotp.mockResolvedValue({ id: 'p' });
      repo.countUnusedRecoveryCodes.mockResolvedValue(0);

      const status = await service.status('u-1');
      expect(status.enabled).toBe(false);
      expect(status.methods).toEqual([]);
      expect(status.lowRecoveryCodes).toBe(false);
      expect(status.pendingEnrollment).toBe(true);
    });
  });
});
