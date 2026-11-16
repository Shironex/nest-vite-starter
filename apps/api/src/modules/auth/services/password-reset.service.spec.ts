import { TRPCError } from '@trpc/server';
import { createHash } from 'node:crypto';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { PasswordResetService } from './password-reset.service';
import { RateLimitError } from '../../../common/errors';
import { buildPrismaTx, createAuthTestModule, mockPrismaTransaction } from '@test/test-module';
import { userFixture } from '@test/fixtures';

describe('PasswordResetService', () => {
  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [PasswordResetService] });
    return { ...ctx, service: ctx.get(PasswordResetService) };
  };

  describe('forgotPassword()', () => {
    it('happy path: creates reset token, sends email, audits with userId', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findByEmail.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));
      mocks.token.createPasswordResetToken.mockResolvedValue('reset-tok');

      await service.forgotPassword('a@b.c', 'turnstile', '1.2.3.4');

      expect(mocks.token.createPasswordResetToken).toHaveBeenCalledWith('u-1');
      expect(mocks.mail.sendPasswordResetEmail).toHaveBeenCalledWith(
        'a@b.c',
        expect.stringContaining('token=reset-tok'),
        '1.2.3.4',
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_PASSWORD_FORGOT,
          userId: 'u-1',
          targetType: 'User',
          targetId: 'u-1',
          ipAddress: '1.2.3.4',
        }),
      );
    });

    it('OWASP enumeration guard: unknown email resolves silently and audits success: false', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findByEmail.mockResolvedValue(null);

      await expect(service.forgotPassword('x@y.z', 't', '1.2.3.4')).resolves.toBeUndefined();

      expect(mocks.token.createPasswordResetToken).not.toHaveBeenCalled();
      expect(mocks.mail.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_PASSWORD_FORGOT,
          success: false,
          ipAddress: '1.2.3.4',
          metadata: { reason: 'unknown_email' },
        }),
      );
    });

    it('throws Turnstile error before any user lookup', async () => {
      const { service, mocks } = await buildCtx();
      mocks.shared.validateTurnstile.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: AppErrorCode.TURNSTILE_FAILED }),
      );

      await expect(service.forgotPassword('a@b.c', 't', '1.2.3.4')).rejects.toMatchObject({
        message: AppErrorCode.TURNSTILE_FAILED,
      });
      expect(mocks.user.findByEmail).not.toHaveBeenCalled();
    });

    it('still resolves and audits success when sendPasswordResetEmail fails', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findByEmail.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.token.createPasswordResetToken.mockResolvedValue('tok');
      mocks.mail.sendPasswordResetEmail.mockRejectedValue(new Error('SMTP'));

      await expect(service.forgotPassword('a@b.c', 't', '1.2.3.4')).resolves.toBeUndefined();
      // Audit logged the success path (no reason: 'unknown_email').
      const auditCall = mocks.audit.log.mock.calls.at(-1)?.[0];
      expect(auditCall?.userId).toBe('u-1');
      expect(auditCall?.metadata).toBeUndefined();
    });
  });

  describe('forgotPassword(): the two accounts that must not be sent a link', () => {
    it('refuses a removed member, silently and with the generic response', async () => {
      // They keep their address and their account, so a successful reset would
      // leave the login check as the only remaining barrier.
      const { service, mocks } = await buildCtx();
      mocks.user.findByEmail.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));
      mocks.user.findPasswordResetEligibility.mockResolvedValue({
        membershipEnded: true,
        pendingInvite: false,
      });

      await expect(
        service.forgotPassword('a@b.c', 'turnstile', '1.2.3.4'),
      ).resolves.toBeUndefined();

      expect(mocks.token.createPasswordResetToken).not.toHaveBeenCalled();
      expect(mocks.mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('refuses a pending invitee, who would otherwise join without ever accepting', async () => {
      // resetPassword sets a password without flipping emailVerified and without
      // touching the invitation token, and login establishes a session for an
      // unverified user. The result is a member with no staff.invite.accepted
      // row and a live invitation still pointed at an active account.
      const { service, mocks } = await buildCtx();
      mocks.user.findByEmail.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));
      mocks.user.findPasswordResetEligibility.mockResolvedValue({
        membershipEnded: false,
        pendingInvite: true,
      });

      await expect(
        service.forgotPassword('a@b.c', 'turnstile', '1.2.3.4'),
      ).resolves.toBeUndefined();

      expect(mocks.token.createPasswordResetToken).not.toHaveBeenCalled();
    });

    it('records the real reason server-side, where the client cannot read it', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findByEmail.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));
      mocks.user.findPasswordResetEligibility.mockResolvedValue({
        membershipEnded: false,
        pendingInvite: true,
      });

      await service.forgotPassword('a@b.c', 'turnstile', '1.2.3.4');

      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          metadata: expect.objectContaining({ reason: 'pending_invite' }),
        }),
      );
    });
  });

  describe('resetPassword()', () => {
    const rawToken = 'r'.repeat(64);
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    it('happy path: validates token, hashes new password, consumes token, updates user, deletes sessions, audits, notifies', async () => {
      const { service, mocks } = await buildCtx();
      mocks.password.hash.mockResolvedValue('new-hash');
      mocks.prisma.client.token.findFirst.mockResolvedValue({
        id: 'tok-1',
        userId: 'u-1',
        token: hashedToken,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.token.deleteMany.mockResolvedValue({ count: 1 });
      tx.user.updateMany.mockResolvedValue({ count: 1 });
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));

      await service.resetPassword(rawToken, 'NewStrongPwd1!', '1.2.3.4');

      // Per-IP fixed window: tRPC sits outside the global ThrottlerGuard, so
      // this limiter is the token brute-force bound.
      expect(mocks.shared.enforceAuthRateLimit).toHaveBeenCalledWith('reset-password', '1.2.3.4');
      // Token is looked up (outside the tx) BEFORE the password is hashed.
      expect(mocks.prisma.client.token.findFirst).toHaveBeenCalledWith({
        where: { token: hashedToken, type: 'PASSWORD_RESET' },
      });
      expect(mocks.password.hash).toHaveBeenCalledWith('NewStrongPwd1!');
      // Guarded single-use consume inside the tx.
      expect(tx.token.deleteMany).toHaveBeenCalledWith({
        where: { id: 'tok-1', token: hashedToken },
      });
      // Soft-delete guarded write: a deleted row must not take a new credential.
      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u-1', deletedAt: null, membershipEndedAt: null },
        data: {
          passwordHash: 'new-hash',
          failedAttempts: 0,
          lockoutCount: 0,
          lockedUntil: null,
        },
      });
      // Sessions revoked AFTER transaction commits; live sockets dropped in
      // the same shared step.
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-1');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
          userId: 'u-1',
        }),
      );
      expect(mocks.mail.sendPasswordChangedEmail).toHaveBeenCalledWith('a@b.c');
    });

    const validTokenRecord = () => ({
      id: 'tok-1',
      userId: 'u-1',
      token: hashedToken,
      type: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + 60_000),
    });

    it('2FA gate: an account with an active factor and NO code is rejected before hashing', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.token.findFirst.mockResolvedValue(validTokenRecord());
      mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'f', type: 'TOTP' });

      await expect(
        service.resetPassword(rawToken, 'NewStrongPwd1!', '1.2.3.4'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE });
      expect(mocks.password.hash).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_FAILURE }),
      );
    });

    it('2FA gate: a valid TOTP code lets the reset proceed and forgets trusted devices', async () => {
      const { service, mocks } = await buildCtx();
      mocks.password.hash.mockResolvedValue('new-hash');
      mocks.prisma.client.token.findFirst.mockResolvedValue(validTokenRecord());
      mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'f', type: 'TOTP' });
      mocks.secondFactor.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      mocks.totp.verify.mockResolvedValue(true);
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.token.deleteMany.mockResolvedValue({ count: 1 });
      tx.user.updateMany.mockResolvedValue({ count: 1 });
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', email: 'a@b.c' }));

      await service.resetPassword(rawToken, 'NewStrongPwd1!', '1.2.3.4', '123456');

      expect(mocks.password.hash).toHaveBeenCalled();
      expect(mocks.trustedDevice.revokeAll).toHaveBeenCalledWith('u-1');
      // A pending email change dies with the credential rotation (the
      // password-change posture).
      expect(mocks.emailChange.invalidatePending).toHaveBeenCalledWith('u-1');
    });

    it('throws INVALID_TOKEN when token not found; never hashes the password, no session deletion', async () => {
      const { service, mocks } = await buildCtx();
      mocks.password.hash.mockResolvedValue('h');
      mocks.prisma.client.token.findFirst.mockResolvedValue(null);
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());

      await expect(service.resetPassword(rawToken, 'pw', '1.2.3.4')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: AppErrorCode.INVALID_TOKEN,
      });
      // Validate-before-hash: the expensive hash must NOT run for a bad token.
      expect(mocks.password.hash).not.toHaveBeenCalled();
      expect(tx.token.deleteMany).not.toHaveBeenCalled();
      expect(tx.user.updateMany).not.toHaveBeenCalled();
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('expired token: consumes it (one-time use) then throws INVALID_TOKEN without hashing or updating', async () => {
      const { service, mocks } = await buildCtx();
      mocks.password.hash.mockResolvedValue('h');
      mocks.prisma.client.token.findFirst.mockResolvedValue({
        id: 'tok-2',
        userId: 'u-1',
        token: hashedToken,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() - 1000),
      });
      mocks.prisma.client.token.deleteMany.mockResolvedValue({ count: 1 });
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());

      await expect(service.resetPassword(rawToken, 'pw', '1.2.3.4')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: AppErrorCode.INVALID_TOKEN,
      });
      // Expired token is deleted (outside the tx) before the throw.
      expect(mocks.prisma.client.token.deleteMany).toHaveBeenCalledWith({ where: { id: 'tok-2' } });
      // No hashing, no update, no session invalidation.
      expect(mocks.password.hash).not.toHaveBeenCalled();
      expect(tx.user.updateMany).not.toHaveBeenCalled();
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    it('soft-deleted user: the guarded write matches zero rows, throws INVALID_TOKEN, and revokes nothing', async () => {
      const { service, mocks } = await buildCtx();
      mocks.password.hash.mockResolvedValue('new-hash');
      mocks.prisma.client.token.findFirst.mockResolvedValue({
        id: 'tok-3',
        userId: 'u-deleted',
        token: hashedToken,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.token.deleteMany.mockResolvedValue({ count: 1 });
      // The user soft-deleted their account after requesting the reset: the
      // { id, deletedAt: null } guard matches nothing.
      tx.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.resetPassword(rawToken, 'pw', '1.2.3.4')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        // INVALID_TOKEN, not NOT_FOUND: the response must not reveal whether
        // the account behind a guessed token exists or was deleted.
        message: AppErrorCode.INVALID_TOKEN,
      });
      expect(tx.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-deleted', deletedAt: null, membershipEndedAt: null },
        }),
      );
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
      expect(mocks.mail.sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('rate limit: surfaces TOO_MANY_REQUESTS from the per-IP limiter before any token lookup', async () => {
      const { service, mocks } = await buildCtx();
      mocks.shared.enforceAuthRateLimit.mockRejectedValue(new RateLimitError());

      await expect(service.resetPassword(rawToken, 'pw', '1.2.3.4')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: AppErrorCode.RATE_LIMITED,
      });
      expect(mocks.prisma.client.token.findFirst).not.toHaveBeenCalled();
      expect(mocks.password.hash).not.toHaveBeenCalled();
    });

    it('still resolves when post-reset notification email fails', async () => {
      const { service, mocks } = await buildCtx();
      mocks.password.hash.mockResolvedValue('new-hash');
      mocks.prisma.client.token.findFirst.mockResolvedValue({
        id: 'tok-1',
        userId: 'u-1',
        token: hashedToken,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.token.deleteMany.mockResolvedValue({ count: 1 });
      tx.user.updateMany.mockResolvedValue({ count: 1 });
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1' }));
      mocks.mail.sendPasswordChangedEmail.mockRejectedValue(new Error('SMTP'));

      await expect(service.resetPassword(rawToken, 'pw', '1.2.3.4')).resolves.toBeUndefined();
    });
  });

  describe('getResetTokenState()', () => {
    const tokenRaw = 'r'.repeat(64);
    const tokenHash = createHash('sha256').update(tokenRaw).digest('hex');

    it('reports requiresTwoFactor when a valid token belongs to an account with a factor', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.token.findFirst.mockResolvedValue({
        id: 'tok-1',
        userId: 'u-1',
        token: tokenHash,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60_000),
      });
      mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'f', type: 'TOTP' });

      await expect(service.getResetTokenState(tokenRaw, '1.2.3.4')).resolves.toEqual({
        valid: true,
        requiresTwoFactor: true,
      });
    });

    it('reports invalid for a missing/expired token and never consumes it', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.token.findFirst.mockResolvedValue(null);

      await expect(service.getResetTokenState(tokenRaw, '1.2.3.4')).resolves.toEqual({
        valid: false,
        requiresTwoFactor: false,
      });
      expect(mocks.prisma.client.token.deleteMany).not.toHaveBeenCalled();
    });
  });
});
