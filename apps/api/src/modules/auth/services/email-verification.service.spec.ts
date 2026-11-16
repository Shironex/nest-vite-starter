import { TRPCError } from '@trpc/server';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { EmailVerificationService } from './email-verification.service';
import { TokenType } from './token.service';
import { RateLimitError } from '../../../common/errors';
import { buildPrismaTx, createAuthTestModule, mockPrismaTransaction } from '@test/test-module';
import { userFixture } from '@test/fixtures';

describe('EmailVerificationService', () => {
  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [EmailVerificationService] });
    return { ...ctx, service: ctx.get(EmailVerificationService) };
  };

  describe('verifyEmail()', () => {
    it('happy path: consumes token + marks user verified in ONE transaction, audits, sends welcome', async () => {
      const { service, mocks } = await buildCtx();
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      mocks.token.validateToken.mockResolvedValue({ userId: 'u-1' });
      mocks.user.verifyEmail.mockResolvedValue(undefined);
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', email: 'e@x.com' }));

      await service.verifyEmail('raw-token', '1.2.3.4');

      // Per-IP fixed window: tRPC sits outside the global ThrottlerGuard, so
      // this limiter is the token brute-force bound.
      expect(mocks.shared.enforceAuthRateLimit).toHaveBeenCalledWith('verify-email', '1.2.3.4');
      // The token consume and the emailVerified flip share the SAME tx client,
      // so a crash between them rolls both back (token not burned).
      expect(mocks.prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(mocks.token.validateToken).toHaveBeenCalledWith(
        'raw-token',
        TokenType.EMAIL_VERIFICATION,
        tx,
      );
      expect(mocks.user.verifyEmail).toHaveBeenCalledWith('u-1', tx);
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_EMAIL_VERIFIED,
          userId: 'u-1',
          targetType: 'User',
          targetId: 'u-1',
        }),
      );
      expect(mocks.mail.sendWelcomeEmail).toHaveBeenCalledWith(
        'e@x.com',
        expect.stringContaining('/auth/login'),
        // The user id rides along as the welcome-{userId} dedupe key.
        'u-1',
      );
    });

    it('revokes every session minted before verification, only after the flip committed', async () => {
      // Registration opens a session before the inbox is proven, so whoever
      // typed the address may hold it. Nothing minted before verification
      // survives it, the presenting session included.
      const { service, mocks } = await buildCtx();
      const order: string[] = [];
      mocks.prisma.client.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const out = await cb(buildPrismaTx());
          order.push('commit');
          return out;
        },
      );
      mocks.token.validateToken.mockResolvedValue({ userId: 'u-1' });
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.sessionRevocation.revokeAllAndDisconnect.mockImplementation(async () => {
        order.push('revoke');
      });

      await service.verifyEmail('raw-token', '1.2.3.4');

      expect(mocks.sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledTimes(1);
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-1');
      // The epoch bump must follow the committed state change it answers.
      expect(order).toEqual(['commit', 'revoke']);
    });

    it('throws BAD_REQUEST/INVALID_TOKEN when token is invalid; no verify, no audit, no welcome email', async () => {
      const { service, mocks } = await buildCtx();
      mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      mocks.token.validateToken.mockResolvedValue(null);

      await expect(service.verifyEmail('bad', '1.2.3.4')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: AppErrorCode.INVALID_TOKEN,
      });
      expect(mocks.user.verifyEmail).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
      expect(mocks.mail.sendWelcomeEmail).not.toHaveBeenCalled();
      // A bad token proves nothing, so it must not log anyone out either.
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    it('rate limit: surfaces TOO_MANY_REQUESTS from the per-IP limiter before any token work', async () => {
      const { service, mocks } = await buildCtx();
      mocks.shared.enforceAuthRateLimit.mockRejectedValue(new RateLimitError());

      await expect(service.verifyEmail('t', '1.2.3.4')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: AppErrorCode.RATE_LIMITED,
      });
      expect(mocks.prisma.client.$transaction).not.toHaveBeenCalled();
      expect(mocks.token.validateToken).not.toHaveBeenCalled();
    });

    it('still resolves when sendWelcomeEmail fails', async () => {
      const { service, mocks } = await buildCtx();
      mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      mocks.token.validateToken.mockResolvedValue({ userId: 'u-1' });
      mocks.user.findById.mockResolvedValue(userFixture());
      mocks.mail.sendWelcomeEmail.mockRejectedValue(new Error('SMTP'));

      await expect(service.verifyEmail('t', '1.2.3.4')).resolves.toBeUndefined();
      expect(mocks.audit.log).toHaveBeenCalled();
    });

    it('handles user disappearing post-verification (findById returns null) without throw', async () => {
      const { service, mocks } = await buildCtx();
      mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      mocks.token.validateToken.mockResolvedValue({ userId: 'u-1' });
      mocks.user.findById.mockResolvedValue(null);

      await expect(service.verifyEmail('t', '1.2.3.4')).resolves.toBeUndefined();
      expect(mocks.mail.sendWelcomeEmail).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification()', () => {
    it('happy path: enforces the Redis fixed-window limit, finds user, creates token, sends email', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', email: 'e@x.com' }));
      mocks.token.createVerificationToken.mockResolvedValue('new-raw-token');

      await service.resendVerification('u-1', 'turnstile', '1.2.3.4');

      expect(mocks.shared.validateTurnstile).toHaveBeenCalledWith('turnstile', '1.2.3.4');
      // Per-user fixed window: 3 per hour, keyed on the user id.
      expect(mocks.shared.enforceRateLimit).toHaveBeenCalledWith(
        'resend-verification:u-1',
        3,
        3600,
      );
      expect(mocks.token.createVerificationToken).toHaveBeenCalledWith('u-1');
      expect(mocks.mail.sendVerificationEmail).toHaveBeenCalledWith(
        'e@x.com',
        expect.stringContaining('token=new-raw-token'),
      );
    });

    it('still resolves when the verification-email enqueue rejects (log, do not throw)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', email: 'e@x.com' }));
      mocks.token.createVerificationToken.mockResolvedValue('new-raw-token');
      mocks.mail.sendVerificationEmail.mockRejectedValue(new Error('enqueue failed'));

      await expect(
        service.resendVerification('u-1', 'turnstile', '1.2.3.4'),
      ).resolves.toBeUndefined();
    });

    it('throws Turnstile error before any rate-limit or token work', async () => {
      const { service, mocks } = await buildCtx();
      mocks.shared.validateTurnstile.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: AppErrorCode.TURNSTILE_FAILED }),
      );

      await expect(service.resendVerification('u-1', 't', '1.2.3.4')).rejects.toMatchObject({
        message: AppErrorCode.TURNSTILE_FAILED,
      });
      expect(mocks.shared.enforceRateLimit).not.toHaveBeenCalled();
      expect(mocks.token.createVerificationToken).not.toHaveBeenCalled();
    });

    it('rate limit: surfaces TOO_MANY_REQUESTS from the limiter and creates no token', async () => {
      const { service, mocks } = await buildCtx();
      mocks.shared.enforceRateLimit.mockRejectedValue(new RateLimitError());

      await expect(service.resendVerification('u-1', 't', '1.2.3.4')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: AppErrorCode.RATE_LIMITED,
      });
      expect(mocks.user.findById).not.toHaveBeenCalled();
      expect(mocks.token.createVerificationToken).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when user not found', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(null);

      await expect(service.resendVerification('u-1', 't', '1.2.3.4')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
      expect(mocks.token.createVerificationToken).not.toHaveBeenCalled();
    });
  });
});
