import { AppErrorCode } from '@repo/shared/errors';
import { createAuthTestModule } from '@test/test-module';
import { userFixture } from '@test/fixtures';
import { SUDO_TTL_SECONDS } from '../auth.constants';
import { SudoService } from './sudo.service';

describe('SudoService', () => {
  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [SudoService] });
    return { ...ctx, service: ctx.get(SudoService) };
  };

  describe('confirmPassword()', () => {
    it('verifies the password and grants a 300 s sudo flag keyed by the SESSION', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(true);

      await service.confirmPassword('u-1', 'sess-1', 'correct-pw');

      expect(mocks.password.verify).toHaveBeenCalledWith(
        userFixture({ id: 'u-1' }).passwordHash,
        'correct-pw',
      );
      // Session-scoped, never user-scoped: confirming on one device must not
      // elevate a session on another.
      expect(mocks.redis.setex).toHaveBeenCalledWith('sudo:sess-1', SUDO_TTL_SECONDS, '1');
    });

    it('is rate limited per USER (a hijacked session can rotate IPs)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(true);

      await service.confirmPassword('u-1', 'sess-1', 'pw');

      expect(mocks.shared.enforceRateLimit).toHaveBeenCalledWith('sudo:u-1', 5, 300);
    });

    it('rejects a wrong password with INVALID_CREDENTIALS and grants nothing', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.password.verify.mockResolvedValue(false);

      await expect(service.confirmPassword('u-1', 'sess-1', 'wrong')).rejects.toMatchObject({
        appCode: AppErrorCode.INVALID_CREDENTIALS,
      });
      expect(mocks.redis.setex).not.toHaveBeenCalled();
      // Mirrors TwoFactorService.requireSudo: no lockout feed from the
      // authenticated self-scoped gate (a typo lever would be a self-DoS).
      expect(mocks.lockout.recordFailedAttempt).not.toHaveBeenCalled();
    });

    it('fails CLOSED with PASSWORD_NOT_SET for an account with no password (null hash)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(
        userFixture({ id: 'u-1', passwordHash: null }),
      );

      await expect(service.confirmPassword('u-1', 'sess-1', 'anything')).rejects.toMatchObject({
        appCode: AppErrorCode.PASSWORD_NOT_SET,
      });
      expect(mocks.password.verify).not.toHaveBeenCalled();
      expect(mocks.redis.setex).not.toHaveBeenCalled();
    });

    it('rejects when the account vanished since the session was minted', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findCredentialById.mockResolvedValue(null);

      await expect(service.confirmPassword('u-gone', 'sess-1', 'pw')).rejects.toMatchObject({
        appCode: AppErrorCode.UNAUTHORIZED,
      });
    });
  });

  describe('isActive()', () => {
    it('reports a live grant without extending its TTL', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.get.mockResolvedValue('1');

      await expect(service.isActive('sess-1')).resolves.toBe(true);

      expect(mocks.redis.get).toHaveBeenCalledWith('sudo:sess-1');
      expect(mocks.redis.expire).not.toHaveBeenCalled();
      expect(mocks.redis.setex).not.toHaveBeenCalled();
    });

    it('reports an expired or never-granted session as not elevated', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.get.mockResolvedValue(null);

      await expect(service.isActive('sess-1')).resolves.toBe(false);
    });
  });
});
