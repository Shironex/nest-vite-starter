import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { TwoFactorAdminResetService } from './two-factor-admin-reset.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { createAuthTestModule } from '@test/test-module';

describe('TwoFactorAdminResetService', () => {
  const buildCtx = async () => {
    const prisma = {
      client: {
        user: { findFirst: jest.fn() },
      },
    };
    const ctx = await createAuthTestModule({
      providers: [TwoFactorAdminResetService, { provide: PrismaService, useValue: prisma }],
    });
    return { ...ctx, service: ctx.get(TwoFactorAdminResetService), prisma };
  };

  describe('resetUserTwoFactor', () => {
    it('wipes factors + trust + pendings, revokes sessions, audits and emails the member', async () => {
      const { service, mocks, prisma } = await buildCtx();
      prisma.client.user.findFirst.mockResolvedValue({ id: 'm1', email: 'm1@x.c' });
      mocks.redis.smembers.mockResolvedValue([]);

      await service.resetUserTwoFactor('admin-1', 'm1', 'ip', 'ua');

      expect(mocks.secondFactor.deleteAllForUser).toHaveBeenCalledWith('m1');
      expect(mocks.trustedDevice.revokeAll).toHaveBeenCalledWith('m1');
      expect(mocks.session.deleteAllUserSessions).toHaveBeenCalledWith('m1');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_ADMIN_RESET }),
      );
      expect(mocks.mail.sendTwoFactorAdminResetEmail).toHaveBeenCalledWith('m1@x.c');
    });

    it('refuses to reset the caller themselves', async () => {
      const { service } = await buildCtx();
      await expect(
        service.resetUserTwoFactor('admin-1', 'admin-1', 'ip', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.FORBIDDEN });
    });

    it('refuses a target that is not a live account (fail closed)', async () => {
      const { service, prisma } = await buildCtx();
      prisma.client.user.findFirst.mockResolvedValue(null);
      await expect(
        service.resetUserTwoFactor('admin-1', 'other', 'ip', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.FORBIDDEN });
    });
  });
});
