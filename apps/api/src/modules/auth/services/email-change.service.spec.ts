import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { EmailChangeService } from './email-change.service';
import { TokenType } from './token.service';
import { RateLimitError } from '../../../common/errors';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { sha256Hex } from '../../../common/utils/crypto';
import { buildPrismaTx, createAuthTestModule, mockPrismaTransaction } from '@test/test-module';
import { userFixture } from '@test/fixtures';

describe('EmailChangeService', () => {
  const buildCtx = async () => {
    // Last-wins provider override: the REAL service replaces the default
    // emailChange mock (the pattern TwoFactorChallengeService's spec uses).
    const ctx = await createAuthTestModule({ providers: [EmailChangeService] });
    return { ...ctx, service: ctx.get(EmailChangeService) };
  };

  const owner = () => userFixture({ id: 'u-1', email: 'old@x.com' });

  describe('requestEmailChange()', () => {
    it('happy path: stores the pending change in Redis, mails the NEW address the link and the OLD address the tripwire, audits', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(owner());
      mocks.user.findByEmail.mockResolvedValue(null);

      await service.requestEmailChange('u-1', 'new@x.com', undefined, '1.2.3.4', 'jest-ua');

      // Per-user fixed window (3/h), the mail-bombing and brute-force bound.
      expect(mocks.shared.enforceRateLimit).toHaveBeenCalledWith('email-change:u-1', 3, 3600);

      // Pending record: token-keyed blob + per-user index, both with the 1 h TTL.
      const chain = mocks.redis.multi.mock.results[0]?.value as {
        setex: jest.Mock;
        exec: jest.Mock;
      };
      expect(chain.setex).toHaveBeenCalledTimes(2);
      const [tokenKey, tokenTtl, blob] = chain.setex.mock.calls[0] as [string, number, string];
      expect(tokenKey).toMatch(/^email_change:/);
      expect(tokenTtl).toBe(3600);
      expect(JSON.parse(blob)).toEqual({ userId: 'u-1', newEmail: 'new@x.com' });
      expect(chain.setex.mock.calls[1][0]).toBe(RedisKeys.emailChangeUser('u-1'));

      // VERIFY-BEFORE-SWITCH: the request writes NOTHING to the user row;
      // only confirmEmailChange (link consumed) may move the identity.
      expect(mocks.prisma.client.user.updateMany).not.toHaveBeenCalled();
      expect(mocks.prisma.client.$transaction).not.toHaveBeenCalled();

      // Confirmation link goes to the NEW address and embeds the raw token
      // whose sha256 is the Redis key (the mail is the only raw-token holder).
      expect(mocks.mail.sendEmailChangeVerificationEmail).toHaveBeenCalledWith(
        'new@x.com',
        expect.stringContaining('/auth/confirm-email-change?token='),
      );
      const confirmUrl = mocks.mail.sendEmailChangeVerificationEmail.mock.calls[0][1] as string;
      const rawToken = confirmUrl.split('token=')[1]!;
      expect(tokenKey).toBe(RedisKeys.emailChange(sha256Hex(rawToken)));

      // Tripwire to the OLD address names where the identity is moving.
      expect(mocks.mail.sendEmailChangeRequestedEmail).toHaveBeenCalledWith(
        'old@x.com',
        'new@x.com',
      );

      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_EMAIL_CHANGE_REQUESTED,
          userId: 'u-1',
          targetType: 'User',
          targetId: 'u-1',
          ipAddress: '1.2.3.4',
          userAgent: 'jest-ua',
          metadata: { newEmail: 'new@x.com' },
        }),
      );
    });

    it('replaces a previous pending change (delete-then-create, one live token per user)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(owner());
      mocks.user.findByEmail.mockResolvedValue(null);
      mocks.redis.getdel.mockResolvedValue('stale-hash');

      await service.requestEmailChange('u-1', 'new@x.com', undefined, '1.2.3.4', 'ua');

      expect(mocks.redis.getdel).toHaveBeenCalledWith(RedisKeys.emailChangeUser('u-1'));
      expect(mocks.redis.del).toHaveBeenCalledWith(RedisKeys.emailChange('stale-hash'));
    });

    it('rejects an address already in use with the EXISTING EMAIL_IN_USE code; nothing stored, nothing mailed', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(owner());
      mocks.user.findByEmail.mockResolvedValue(userFixture({ id: 'u-2', email: 'taken@x.com' }));

      await expect(
        service.requestEmailChange('u-1', 'taken@x.com', undefined, '1.2.3.4', 'ua'),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', appCode: AppErrorCode.EMAIL_IN_USE });
      expect(mocks.redis.multi).not.toHaveBeenCalled();
      expect(mocks.mail.sendEmailChangeVerificationEmail).not.toHaveBeenCalled();
      expect(mocks.mail.sendEmailChangeRequestedEmail).not.toHaveBeenCalled();
    });

    it("rejects the account's own current address as EMAIL_IN_USE (case-insensitive)", async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(owner());

      await expect(
        service.requestEmailChange('u-1', 'OLD@X.com', undefined, '1.2.3.4', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.EMAIL_IN_USE });
      // Refused before the uniqueness lookup: it is the same row.
      expect(mocks.user.findByEmail).not.toHaveBeenCalled();
    });

    it('rejects a disposable domain with DISPOSABLE_EMAIL (parity with register)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(owner());
      mocks.user.isDisposableEmail.mockResolvedValue(true);

      await expect(
        service.requestEmailChange('u-1', 'x@mailinator.com', undefined, '1.2.3.4', 'ua'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', appCode: AppErrorCode.DISPOSABLE_EMAIL });
    });

    describe('2FA branch', () => {
      it('with an active factor and NO code: TWO_FACTOR_INVALID_CODE, audited as a challenge failure, nothing stored', async () => {
        const { service, mocks } = await buildCtx();
        mocks.user.findById.mockResolvedValue(owner());
        mocks.user.findByEmail.mockResolvedValue(null);
        mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });

        await expect(
          service.requestEmailChange('u-1', 'new@x.com', undefined, '1.2.3.4', 'ua'),
        ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE });

        // Shares the 2FA management envelope (5/300 s) with the other gates.
        expect(mocks.shared.enforceRateLimit).toHaveBeenCalledWith('2fa-manage:u-1', 5, 300);
        expect(mocks.audit.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_FAILURE,
            success: false,
            metadata: { reason: 'bad_code', context: 'email_change' },
          }),
        );
        expect(mocks.redis.multi).not.toHaveBeenCalled();
        expect(mocks.mail.sendEmailChangeVerificationEmail).not.toHaveBeenCalled();
      });

      it('with an active factor and a WRONG TOTP: rejected the same way', async () => {
        const { service, mocks } = await buildCtx();
        mocks.user.findById.mockResolvedValue(owner());
        mocks.user.findByEmail.mockResolvedValue(null);
        mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });
        mocks.secondFactor.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
        mocks.totp.verify.mockResolvedValue(false);

        await expect(
          service.requestEmailChange('u-1', 'new@x.com', '000000', '1.2.3.4', 'ua'),
        ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE });
        expect(mocks.totp.verify).toHaveBeenCalledWith('u-1', 'enc', '000000');
      });

      it('with an active factor and a VALID TOTP: proceeds to store and mail', async () => {
        const { service, mocks } = await buildCtx();
        mocks.user.findById.mockResolvedValue(owner());
        mocks.user.findByEmail.mockResolvedValue(null);
        mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });
        mocks.secondFactor.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
        mocks.totp.verify.mockResolvedValue(true);

        await service.requestEmailChange('u-1', 'new@x.com', '123 456', '1.2.3.4', 'ua');

        // Whitespace-normalized like the challenge flow.
        expect(mocks.totp.verify).toHaveBeenCalledWith('u-1', 'enc', '123456');
        expect(mocks.mail.sendEmailChangeVerificationEmail).toHaveBeenCalled();
      });

      it('accepts a recovery code (single input field serves both shapes)', async () => {
        const { service, mocks } = await buildCtx();
        mocks.user.findById.mockResolvedValue(owner());
        mocks.user.findByEmail.mockResolvedValue(null);
        mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });
        mocks.secondFactor.redeemRecoveryCode.mockResolvedValue(true);

        await service.requestEmailChange(
          'u-1',
          'new@x.com',
          'ABCD-EFGH-JKMN-PQRS',
          '1.2.3.4',
          'ua',
        );

        expect(mocks.secondFactor.redeemRecoveryCode).toHaveBeenCalledWith(
          'u-1',
          expect.any(String),
          expect.any(Date),
        );
        expect(mocks.mail.sendEmailChangeVerificationEmail).toHaveBeenCalled();
      });

      it('without an active factor, no code is demanded', async () => {
        const { service, mocks } = await buildCtx();
        mocks.user.findById.mockResolvedValue(owner());
        mocks.user.findByEmail.mockResolvedValue(null);

        await service.requestEmailChange('u-1', 'new@x.com', undefined, '1.2.3.4', 'ua');
        expect(mocks.totp.verify).not.toHaveBeenCalled();
        expect(mocks.mail.sendEmailChangeVerificationEmail).toHaveBeenCalled();
      });
    });

    it('propagates a failed confirmation-link enqueue (critical mail) and skips tripwire + audit', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(owner());
      mocks.user.findByEmail.mockResolvedValue(null);
      mocks.mail.sendEmailChangeVerificationEmail.mockRejectedValue(new Error('queue down'));

      await expect(
        service.requestEmailChange('u-1', 'new@x.com', undefined, '1.2.3.4', 'ua'),
      ).rejects.toThrow('queue down');
      expect(mocks.mail.sendEmailChangeRequestedEmail).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('still resolves when the tripwire enqueue fails (best-effort security notice)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.user.findById.mockResolvedValue(owner());
      mocks.user.findByEmail.mockResolvedValue(null);
      mocks.mail.sendEmailChangeRequestedEmail.mockRejectedValue(new Error('queue down'));

      await expect(
        service.requestEmailChange('u-1', 'new@x.com', undefined, '1.2.3.4', 'ua'),
      ).resolves.toBeUndefined();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_EMAIL_CHANGE_REQUESTED }),
      );
    });

    it('surfaces TOO_MANY_REQUESTS from the per-user limiter before any other work', async () => {
      const { service, mocks } = await buildCtx();
      mocks.shared.enforceRateLimit.mockRejectedValue(new RateLimitError());

      await expect(
        service.requestEmailChange('u-1', 'new@x.com', undefined, '1.2.3.4', 'ua'),
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      expect(mocks.user.findById).not.toHaveBeenCalled();
    });
  });

  describe('confirmEmailChange()', () => {
    const rawToken = 'raw-token';
    const tokenHash = sha256Hex(rawToken);
    const pendingBlob = JSON.stringify({ userId: 'u-1', newEmail: 'new@x.com' });

    it('happy path: consumes the token, flips email + emailVerified, revokes old-address tokens, revokes sessions, audits before/after', async () => {
      const { service, mocks } = await buildCtx();
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.user.updateMany.mockResolvedValue({ count: 1 });
      mocks.redis.getdel.mockResolvedValue(pendingBlob);
      mocks.redis.get.mockResolvedValue(tokenHash);
      mocks.user.findById.mockResolvedValue(owner());

      await service.confirmEmailChange(rawToken, '9.9.9.9');

      // Per-IP fixed window is the token brute-force bound (public procedure).
      expect(mocks.shared.enforceAuthRateLimit).toHaveBeenCalledWith(
        'confirm-email-change',
        '9.9.9.9',
      );
      // Single-use: destroyed on first touch via GETDEL, keyed by sha256.
      expect(mocks.redis.getdel).toHaveBeenCalledWith(RedisKeys.emailChange(tokenHash));
      // The per-user index still pointed at this token, so it is dropped too.
      expect(mocks.redis.del).toHaveBeenCalledWith(RedisKeys.emailChangeUser('u-1'));

      // The switch is guarded by the soft-delete filter, and consuming the
      // link IS the verification of the new address.
      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u-1', deletedAt: null },
        data: { email: 'new@x.com', emailVerified: true },
      });
      // Links mailed to the OLD address die inside the same transaction.
      expect(mocks.token.invalidateUserTokens).toHaveBeenCalledWith(
        'u-1',
        TokenType.PASSWORD_RESET,
        tx,
      );
      expect(mocks.token.invalidateUserTokens).toHaveBeenCalledWith(
        'u-1',
        TokenType.EMAIL_VERIFICATION,
        tx,
      );

      // Every session out (epoch bump lives in deleteAllUserSessions).
      expect(mocks.session.deleteAllUserSessions).toHaveBeenCalledWith('u-1');

      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_EMAIL_CHANGED,
          userId: 'u-1',
          targetType: 'User',
          targetId: 'u-1',
          before: { email: 'old@x.com' },
          after: { email: 'new@x.com' },
        }),
      );
    });

    it('rejects an unknown or expired token with INVALID_TOKEN; no update, no revocation', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue(null);

      await expect(service.confirmEmailChange('bad', '9.9.9.9')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        appCode: AppErrorCode.INVALID_TOKEN,
      });
      expect(mocks.prisma.client.$transaction).not.toHaveBeenCalled();
      expect(mocks.session.deleteAllUserSessions).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('rejects a corrupt Redis blob as INVALID_TOKEN (parse, never cast)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue('{"not":"a pending change"}');

      await expect(service.confirmEmailChange(rawToken, '9.9.9.9')).rejects.toMatchObject({
        appCode: AppErrorCode.INVALID_TOKEN,
      });
    });

    it('leaves the per-user index alone when a NEWER request owns it', async () => {
      const { service, mocks } = await buildCtx();
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.user.updateMany.mockResolvedValue({ count: 1 });
      mocks.redis.getdel.mockResolvedValue(pendingBlob);
      mocks.redis.get.mockResolvedValue('a-newer-token-hash');
      mocks.user.findById.mockResolvedValue(owner());

      await service.confirmEmailChange(rawToken, '9.9.9.9');
      expect(mocks.redis.del).not.toHaveBeenCalledWith(RedisKeys.emailChangeUser('u-1'));
    });

    it('maps a unique-constraint race on User.email to EMAIL_IN_USE (address registered during the window)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue(pendingBlob);
      mocks.redis.get.mockResolvedValue(tokenHash);
      mocks.user.findById.mockResolvedValue(owner());
      mocks.prisma.client.$transaction.mockRejectedValue(
        Object.assign(new Error('unique'), {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['email'] },
        }),
      );

      await expect(service.confirmEmailChange(rawToken, '9.9.9.9')).rejects.toMatchObject({
        appCode: AppErrorCode.EMAIL_IN_USE,
      });
      expect(mocks.session.deleteAllUserSessions).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('answers INVALID_TOKEN when the account is gone or soft-deleted (no state oracle for a link holder)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue(pendingBlob);
      mocks.redis.get.mockResolvedValue(tokenHash);
      mocks.user.findById.mockResolvedValue(null);

      await expect(service.confirmEmailChange(rawToken, '9.9.9.9')).rejects.toMatchObject({
        appCode: AppErrorCode.INVALID_TOKEN,
      });

      // Soft-deleted between findById and the update: zero rows, same answer.
      const { service: service2, mocks: mocks2 } = await buildCtx();
      const tx2 = mockPrismaTransaction(mocks2.prisma, buildPrismaTx());
      tx2.user.updateMany.mockResolvedValue({ count: 0 });
      mocks2.redis.getdel.mockResolvedValue(pendingBlob);
      mocks2.redis.get.mockResolvedValue(tokenHash);
      mocks2.user.findById.mockResolvedValue(owner());

      await expect(service2.confirmEmailChange(rawToken, '9.9.9.9')).rejects.toMatchObject({
        appCode: AppErrorCode.INVALID_TOKEN,
      });
      expect(mocks2.session.deleteAllUserSessions).not.toHaveBeenCalled();
    });
  });

  describe('invalidatePending()', () => {
    it('drops both the per-user index and the token record', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue('hash-1');

      await service.invalidatePending('u-1');

      expect(mocks.redis.getdel).toHaveBeenCalledWith(RedisKeys.emailChangeUser('u-1'));
      expect(mocks.redis.del).toHaveBeenCalledWith(RedisKeys.emailChange('hash-1'));
    });

    it('is a no-op when nothing is pending', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue(null);

      await service.invalidatePending('u-1');
      expect(mocks.redis.del).not.toHaveBeenCalled();
    });
  });
});
