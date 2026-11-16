import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { TwoFactorPolicyService } from './two-factor-policy.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { requestContext } from '../../../common/context/request-context';
import { createAuthTestModule } from '@test/test-module';

const withTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: 't', tenantId }, fn);

describe('TwoFactorPolicyService', () => {
  const buildCtx = async () => {
    const prisma = {
      client: {
        twoFactorPolicy: {
          findUnique: jest.fn(),
          upsert: jest.fn(),
          // The enable path claims the false -> true transition with a CAS and
          // creates the lazily-absent row, so both write shapes must answer.
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({ required: true, graceEndsAt: null }),
        },
        user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
        $transaction: jest.fn(),
      },
      unscoped: {
        twoFactorPolicy: { findUnique: jest.fn() },
      },
    };
    // The enable path claims the transition inside a transaction so a partial
    // failure cannot leave the row written without the announcement.
    prisma.client.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb(prisma.client),
    );
    const ctx = await createAuthTestModule({
      providers: [TwoFactorPolicyService, { provide: PrismaService, useValue: prisma }],
    });
    return { ...ctx, service: ctx.get(TwoFactorPolicyService), prisma };
  };

  describe('isEnrollmentRequiredForTenant', () => {
    it('true only when required and grace has passed (reads UNSCOPED by tenantId)', async () => {
      const { service, prisma } = await buildCtx();
      prisma.unscoped.twoFactorPolicy.findUnique.mockResolvedValue({
        required: true,
        graceEndsAt: new Date(Date.now() - 1000),
      });
      expect(await service.isEnrollmentRequiredForTenant('t-1')).toBe(true);
      expect(prisma.unscoped.twoFactorPolicy.findUnique).toHaveBeenCalledWith({
        where: { tenantId: 't-1' },
      });
    });

    it('false while grace is still running', async () => {
      const { service, prisma } = await buildCtx();
      prisma.unscoped.twoFactorPolicy.findUnique.mockResolvedValue({
        required: true,
        graceEndsAt: new Date(Date.now() + 60_000),
      });
      expect(await service.isEnrollmentRequiredForTenant('t-1')).toBe(false);
    });

    it('false when there is no policy or it is not required', async () => {
      const { service, prisma } = await buildCtx();
      prisma.unscoped.twoFactorPolicy.findUnique.mockResolvedValue(null);
      expect(await service.isEnrollmentRequiredForTenant('t-1')).toBe(false);
    });
  });

  describe('getTenantPolicy', () => {
    it('fails closed with no tenant context', async () => {
      const { service } = await buildCtx();
      await expect(service.getTenantPolicy()).rejects.toMatchObject({
        appCode: AppErrorCode.FORBIDDEN,
      });
    });

    it('returns the enforced view within a tenant context', async () => {
      const { service, prisma } = await buildCtx();
      prisma.client.twoFactorPolicy.findUnique.mockResolvedValue({
        required: true,
        graceEndsAt: new Date(Date.now() - 1000),
      });
      await expect(withTenant('t-1', () => service.getTenantPolicy())).resolves.toMatchObject({
        required: true,
        enforced: true,
      });
    });
  });

  describe('setTenantPolicy', () => {
    it('enabling starts a fresh grace, audits, and announces to non-enrolled members', async () => {
      const { service, mocks, prisma } = await buildCtx();
      prisma.client.twoFactorPolicy.updateMany.mockResolvedValue({ count: 1 });
      prisma.client.user.findMany.mockResolvedValue([{ id: 'm1', email: 'm1@x.c' }]);

      await withTenant('t-1', () => service.setTenantPolicy(true, 'ip', 'ua'));

      // A compare-and-swap on the transition, not a read-then-write: exactly
      // one concurrent enable may move the row off `required: false`.
      expect(prisma.client.twoFactorPolicy.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 't-1', required: false },
        data: { required: true, graceEndsAt: expect.any(Date) },
      });
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_POLICY_CHANGED }),
      );
      expect(mocks.mail.sendTwoFactorPolicyAnnouncementEmail).toHaveBeenCalledWith(
        'm1@x.c',
        expect.any(Date),
      );
    });

    it('creates the lazily-absent policy row and still announces once', async () => {
      const { service, mocks, prisma } = await buildCtx();
      prisma.client.twoFactorPolicy.updateMany.mockResolvedValue({ count: 0 });
      prisma.client.twoFactorPolicy.findUnique.mockResolvedValue(null);
      prisma.client.user.findMany.mockResolvedValue([{ id: 'm1', email: 'm1@x.c' }]);

      await withTenant('t-1', () => service.setTenantPolicy(true, 'ip', 'ua'));

      expect(prisma.client.twoFactorPolicy.create).toHaveBeenCalledWith({
        data: { tenantId: 't-1', required: true, graceEndsAt: expect.any(Date) },
      });
      expect(mocks.mail.sendTwoFactorPolicyAnnouncementEmail).toHaveBeenCalledTimes(1);
    });

    it('re-affirming an already-required policy is a no-op: no write, audit, or announce', async () => {
      const { service, mocks, prisma } = await buildCtx();
      const graceEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      // The CAS matches nothing because the row is already `required: true`.
      prisma.client.twoFactorPolicy.updateMany.mockResolvedValue({ count: 0 });
      prisma.client.twoFactorPolicy.findUnique.mockResolvedValue({ required: true, graceEndsAt });

      const view = await withTenant('t-1', () => service.setTenantPolicy(true, 'ip', 'ua'));

      expect(prisma.client.twoFactorPolicy.upsert).not.toHaveBeenCalled();
      expect(prisma.client.twoFactorPolicy.create).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
      expect(mocks.mail.sendTwoFactorPolicyAnnouncementEmail).not.toHaveBeenCalled();
      // The original deadline is preserved rather than pushed out another 7 days.
      expect(view).toMatchObject({ required: true, graceEndsAt });
    });

    /**
     * The whole point of the CAS. The announcement jobId is
     * sha256(to:graceEndsAt), and two concurrent enables compute deadlines that
     * differ by the milliseconds between them, so the two batches would NOT
     * collapse: every non-enrolled member would get two announcements naming
     * two different dates.
     */
    it('does not announce twice when a concurrent enable already claimed the transition', async () => {
      const { service, mocks, prisma } = await buildCtx();
      const graceEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      prisma.client.twoFactorPolicy.updateMany.mockResolvedValue({ count: 0 });
      prisma.client.twoFactorPolicy.findUnique.mockResolvedValue({ required: true, graceEndsAt });
      prisma.client.user.findMany.mockResolvedValue([{ id: 'm1', email: 'm1@x.c' }]);

      const view = await withTenant('t-1', () => service.setTenantPolicy(true, 'ip', 'ua'));

      expect(mocks.mail.sendTwoFactorPolicyAnnouncementEmail).not.toHaveBeenCalled();
      // The loser still reports the winner's state, which is the answer the
      // caller asked for.
      expect(view).toMatchObject({ required: true, graceEndsAt });
    });

    it('disabling nulls the grace and does not announce', async () => {
      const { service, mocks, prisma } = await buildCtx();
      prisma.client.twoFactorPolicy.findUnique.mockResolvedValue({
        required: true,
        graceEndsAt: new Date(Date.now() + 60_000),
      });
      prisma.client.twoFactorPolicy.upsert.mockResolvedValue({
        required: false,
        graceEndsAt: null,
      });

      await withTenant('t-1', () => service.setTenantPolicy(false, 'ip', 'ua'));

      expect(prisma.client.twoFactorPolicy.upsert).toHaveBeenCalled();
      expect(mocks.mail.sendTwoFactorPolicyAnnouncementEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetMemberTwoFactor', () => {
    it('wipes factors + trust + pendings, revokes sessions, audits and emails the member', async () => {
      const { service, mocks, prisma } = await buildCtx();
      prisma.client.user.findFirst.mockResolvedValue({ id: 'm1', email: 'm1@x.c' });
      mocks.redis.smembers.mockResolvedValue([]);

      await withTenant('t-1', () => service.resetMemberTwoFactor('admin-1', 'm1', 'ip', 'ua'));

      expect(mocks.secondFactor.deleteAllForUser).toHaveBeenCalledWith('m1');
      expect(mocks.trustedDevice.revokeAll).toHaveBeenCalledWith('m1');
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('m1');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_ADMIN_RESET }),
      );
      expect(mocks.mail.sendTwoFactorAdminResetEmail).toHaveBeenCalledWith('m1@x.c');
    });

    it('refuses to reset the caller themselves', async () => {
      const { service } = await buildCtx();
      await expect(
        withTenant('t-1', () => service.resetMemberTwoFactor('admin-1', 'admin-1', 'ip', 'ua')),
      ).rejects.toMatchObject({ appCode: AppErrorCode.FORBIDDEN });
    });

    it('refuses a target outside the tenant (fail closed)', async () => {
      const { service, prisma } = await buildCtx();
      prisma.client.user.findFirst.mockResolvedValue(null);
      await expect(
        withTenant('t-1', () => service.resetMemberTwoFactor('admin-1', 'other', 'ip', 'ua')),
      ).rejects.toMatchObject({ appCode: AppErrorCode.FORBIDDEN });
    });
  });
});
