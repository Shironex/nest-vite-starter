import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { TwoFactorChallengeService } from './two-factor-challenge.service';
import { TotpService } from './totp.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import { buildRedisChainMock, createAuthTestModule, type RedisMock } from '@test/test-module';
import { expressMocks, userFixture } from '@test/fixtures';

const PENDING_COOKIE = '2fa-pending'; // dev name (NODE_ENV=test)

/**
 * Shape the atomic per-pending attempt counter (MULTI incr + expire NX). `exec`
 * resolves to the `[error, reply]` tuple array, so the INCR reply (index 0)
 * carries the current attempt count the budget check reads.
 */
const primeAttemptCounter = (redis: RedisMock, count: number) => {
  const chain = buildRedisChainMock();
  chain.exec.mockResolvedValue([[null, count]]);
  redis.multi.mockReturnValue(chain);
};

const makeBlob = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    userId: 'u-1',
    email: 'a@b.c',
    role: 'USER',
    emailVerified: true,
    ip: '1.1.1.1',
    userAgent: 'ua',
    rememberMe: false,
    createdAt: 1_700_000_000_000,
    ...overrides,
  });

/** What the mint gate reads for an account that may be handed a session. */
const ELIGIBLE_ROW = { lockedUntil: null, membershipEndedAt: null };

describe('TwoFactorChallengeService', () => {
  const buildCtx = async () => {
    const repo = {
      findActiveNonRecovery: jest.fn(),
      findActiveTotp: jest.fn(),
      redeemRecoveryCode: jest.fn(),
    };
    const totp = { verify: jest.fn() };
    const ctx = await createAuthTestModule({
      providers: [
        TwoFactorChallengeService,
        { provide: SecondFactorRepository, useValue: repo },
        { provide: TotpService, useValue: totp },
      ],
    });
    // The mint gate's live read: an eligible account unless a spec says not.
    ctx.mocks.prisma.client.user.findFirst.mockResolvedValue(ELIGIBLE_ROW);
    return { ...ctx, service: ctx.get(TwoFactorChallengeService), repo, totp };
  };

  const reqWithCookie = (token?: string) => {
    const { req, res } = expressMocks();
    (req as unknown as { cookies: Record<string, string> }).cookies = token
      ? { [PENDING_COOKIE]: token }
      : {};
    return { req, res };
  };

  describe('beginOrEstablish', () => {
    const user = { id: 'u-1', email: 'a@b.c', role: 'USER', emailVerified: true, tenantId: 't-1' };
    const opts = { rememberMe: false, ip: '1.1.1.1', userAgent: 'ua' };

    it('no active factor: establishes the session directly (via no_factor)', async () => {
      const { service, mocks, repo } = await buildCtx();
      const { req, res } = reqWithCookie();
      repo.findActiveNonRecovery.mockResolvedValue(null);

      const result = await service.beginOrEstablish(req, res, user, opts);

      expect(result).toEqual({ kind: 'session', expiresAt: expect.any(Date), via: 'no_factor' });
      expect(mocks.shared.establishSession).toHaveBeenCalledWith(
        req,
        res,
        expect.objectContaining({ userId: 'u-1', tenantId: 't-1', rememberMe: false }),
      );
      expect(mocks.redis.multi).not.toHaveBeenCalled();
    });

    it('active factor: mints a pending record + cookie and returns a challenge (no session)', async () => {
      const { service, mocks, repo } = await buildCtx();
      const { req, res } = reqWithCookie();
      repo.findActiveNonRecovery.mockResolvedValue({ id: 'f', type: 'TOTP' });

      const result = await service.beginOrEstablish(req, res, user, opts);

      expect(result).toEqual({ kind: 'challenge', methods: ['TOTP'] });
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
      expect(mocks.redis.multi).toHaveBeenCalledTimes(1);
      expect(mocks.shared.setAuthCookie).toHaveBeenCalledWith(
        res,
        PENDING_COOKIE,
        expect.any(String),
        expect.any(Number),
      );
    });

    it('carries the caller-captured session epoch onto the session it establishes', async () => {
      const { service, mocks, repo } = await buildCtx();
      const { req, res } = reqWithCookie();
      repo.findActiveNonRecovery.mockResolvedValue(null);

      await service.beginOrEstablish(req, res, user, { ...opts, epoch: 9 });

      // Not re-read here: the fence has to cover the caller's credential read,
      // which happened before this seam was entered.
      expect(mocks.shared.establishSession).toHaveBeenCalledWith(
        req,
        res,
        expect.objectContaining({ epoch: 9 }),
      );
    });

    it('carries the captured epoch into the pending record so the challenge stays fenced', async () => {
      const { service, mocks, repo } = await buildCtx();
      const { req, res } = reqWithCookie();
      repo.findActiveNonRecovery.mockResolvedValue({ id: 'f', type: 'TOTP' });
      const chain = buildRedisChainMock();
      mocks.redis.multi.mockReturnValue(chain);

      await service.beginOrEstablish(req, res, user, { ...opts, epoch: 9 });

      const [, , blob] = chain.setex.mock.calls[0] as [string, number, string];
      expect(JSON.parse(blob)).toMatchObject({ epoch: 9 });
    });

    it('active factor + trusted device: skips the challenge (session via trusted_device)', async () => {
      const { service, mocks, repo } = await buildCtx();
      const { req, res } = reqWithCookie();
      repo.findActiveNonRecovery.mockResolvedValue({ id: 'f', type: 'TOTP' });
      mocks.trustedDevice.isTrusted.mockResolvedValue(true);

      const result = await service.beginOrEstablish(req, res, user, opts);

      expect(result).toEqual({
        kind: 'session',
        expiresAt: expect.any(Date),
        via: 'trusted_device',
      });
      expect(mocks.shared.establishSession).toHaveBeenCalled();
      expect(mocks.redis.multi).not.toHaveBeenCalled(); // no pending record minted
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { method: 'trusted_device' } }),
      );
    });
  });

  describe('beginOrEstablish: live account-state gate', () => {
    const user = { id: 'u-1', email: 'a@b.c', role: 'USER', emailVerified: true, tenantId: 't-1' };
    const opts = { rememberMe: false, ip: '1.1.1.1', userAgent: 'ua' };

    it('re-reads the account by id, soft-delete excluded, before deciding anything', async () => {
      const { service, mocks, repo } = await buildCtx();
      const { req, res } = reqWithCookie();
      repo.findActiveNonRecovery.mockResolvedValue(null);

      await service.beginOrEstablish(req, res, user, opts);

      expect(mocks.prisma.client.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'u-1', deletedAt: null },
        select: { lockedUntil: true, membershipEndedAt: true },
      });
    });

    // The per-door checks (password login) each refuse
    // these states for their own audit reason. These cases hand the seam a
    // snapshot from a caller that checked NOTHING, which is what a new entry
    // point that forgets the list looks like: the seam alone must refuse it.
    it.each([
      ['membership_ended', { lockedUntil: null, membershipEndedAt: new Date('2026-09-01') }, false],
      ['account_locked', { lockedUntil: new Date('2099-01-01'), membershipEndedAt: null }, true],
      ['account_deleted', null, false],
    ] as const)(
      'refuses %s from a caller that checked nothing: no session, no challenge',
      async (reason, row, locked) => {
        const { service, mocks, repo } = await buildCtx();
        const { req, res } = reqWithCookie();
        mocks.prisma.client.user.findFirst.mockResolvedValue(row);
        mocks.lockout.isLockedFromUser.mockReturnValue({ locked });
        // Would otherwise take the challenge arm: the gate has to run first.
        repo.findActiveNonRecovery.mockResolvedValue({ id: 'f', type: 'TOTP' });

        await expect(service.beginOrEstablish(req, res, user, opts)).rejects.toMatchObject({
          appCode: AppErrorCode.INVALID_CREDENTIALS,
        });

        expect(mocks.shared.establishSession).not.toHaveBeenCalled();
        expect(mocks.redis.multi).not.toHaveBeenCalled();
        expect(mocks.shared.setAuthCookie).not.toHaveBeenCalled();
        expect(mocks.audit.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
            userId: 'u-1',
            tenantId: 't-1',
            success: false,
            metadata: { reason, gate: 'session_mint' },
          }),
        );
      },
    );

    it('control: an active member of the same shape gets a session', async () => {
      const { service, mocks, repo } = await buildCtx();
      const { req, res } = reqWithCookie();
      repo.findActiveNonRecovery.mockResolvedValue(null);

      await expect(service.beginOrEstablish(req, res, user, opts)).resolves.toMatchObject({
        kind: 'session',
      });
      expect(mocks.shared.establishSession).toHaveBeenCalledTimes(1);
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });
  });

  describe('verifyChallenge', () => {
    it('missing pending cookie routes back to login (CHALLENGE_EXPIRED)', async () => {
      const { service } = await buildCtx();
      const { req, res } = reqWithCookie();
      await expect(
        service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED });
    });

    it('valid TOTP: consumes the record, establishes the session, audits success(totp)', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      mocks.redis.get.mockResolvedValue(makeBlob());
      primeAttemptCounter(mocks.redis, 1);
      mocks.redis.getdel.mockResolvedValue(makeBlob()); // single-use claim wins
      repo.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(true);
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', emailVerified: true }));

      const result = await service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua');

      expect(result).toMatchObject({ status: 'ok', requiresVerification: false });
      expect(mocks.redis.getdel).toHaveBeenCalledTimes(1);
      expect(mocks.shared.establishSession).toHaveBeenCalled();
      expect(mocks.lockout.resetAttempts).toHaveBeenCalledWith('u-1');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_SUCCESS,
          metadata: { method: 'totp' },
        }),
      );
    });

    it('mints the session with the epoch from the PASSWORD step, not from verify time', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      const blob = makeBlob({ epoch: 5 });
      mocks.redis.get.mockResolvedValue(blob);
      primeAttemptCounter(mocks.redis, 1);
      mocks.redis.getdel.mockResolvedValue(blob);
      repo.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(true);
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', emailVerified: true }));

      await service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua');

      // The credential this session rests on was read at the password step, so
      // a revocation during the challenge must invalidate the mint.
      expect(mocks.shared.establishSession).toHaveBeenCalledWith(
        req,
        res,
        expect.objectContaining({ epoch: 5 }),
      );
    });

    it('strips internal whitespace from a pasted TOTP before verify (does not burn an attempt)', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      mocks.redis.get.mockResolvedValue(makeBlob());
      primeAttemptCounter(mocks.redis, 1);
      mocks.redis.getdel.mockResolvedValue(makeBlob());
      repo.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(true);
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', emailVerified: true }));

      const result = await service.verifyChallenge(req, res, { code: '123 456' }, '1.1.1.1', 'ua');

      expect(result).toMatchObject({ status: 'ok' });
      // The whitespace-stripped digits reach verify, not the raw "123 456".
      expect(totp.verify).toHaveBeenCalledWith('u-1', 'enc', '123456');
    });

    it('valid recovery code: redeemed atomically, method recorded as recovery', async () => {
      const { service, mocks, repo } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      mocks.redis.get.mockResolvedValue(makeBlob());
      primeAttemptCounter(mocks.redis, 1);
      mocks.redis.getdel.mockResolvedValue(makeBlob());
      repo.redeemRecoveryCode.mockResolvedValue(true);
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', emailVerified: true }));

      const result = await service.verifyChallenge(
        req,
        res,
        { code: 'ABCD-EFGH-JKMN-PQRS' },
        '1.1.1.1',
        'ua',
      );

      expect(result).toMatchObject({ status: 'ok' });
      expect(repo.redeemRecoveryCode).toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { method: 'recovery' } }),
      );
      // A spent recovery code is a distinct high-signal event: audited + emailed.
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_RECOVERY_USED }),
      );
      expect(mocks.mail.sendRecoveryCodeUsedEmail).toHaveBeenCalledWith('a@b.c');
    });

    it('mints a trusted device when trustDevice is requested', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      mocks.redis.get.mockResolvedValue(makeBlob());
      primeAttemptCounter(mocks.redis, 1);
      mocks.redis.getdel.mockResolvedValue(makeBlob());
      repo.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(true);
      mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', emailVerified: true }));

      await service.verifyChallenge(
        req,
        res,
        { code: '123456', trustDevice: true },
        '1.1.1.1',
        'ua',
      );

      expect(mocks.trustedDevice.trust).toHaveBeenCalledWith(req, res, 'u-1', '1.1.1.1', 'ua');
    });

    it('bad code: feeds the lockout, audits failure, throws INVALID_CODE, no session', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      mocks.redis.get.mockResolvedValue(makeBlob());
      primeAttemptCounter(mocks.redis, 2);
      repo.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(false);

      await expect(
        service.verifyChallenge(req, res, { code: '000000' }, '1.1.1.1', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE });

      expect(mocks.lockout.recordFailedAttempt).toHaveBeenCalledWith('u-1');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_FAILURE }),
      );
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
      expect(mocks.redis.getdel).not.toHaveBeenCalled();
    });

    it('attempts exhausted: destroys the record, audits LOCKED, routes to login', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      mocks.redis.get.mockResolvedValue(makeBlob());
      primeAttemptCounter(mocks.redis, 6); // 6th attempt exceeds the budget of 5
      mocks.redis.getdel.mockResolvedValue(makeBlob());

      await expect(
        service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED });

      expect(mocks.redis.getdel).toHaveBeenCalledTimes(1);
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.AUTH_2FA_LOCKED,
          metadata: { reason: 'rate_limited' },
        }),
      );
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
    });

    it('lost the GETDEL race: does not establish a second session', async () => {
      const { service, mocks, repo, totp } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      mocks.redis.get.mockResolvedValue(makeBlob());
      primeAttemptCounter(mocks.redis, 1);
      mocks.redis.getdel.mockResolvedValue(null); // a concurrent verify already consumed it
      repo.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(true);

      await expect(
        service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED });
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
    });

    describe('account state changed during the challenge', () => {
      const primeValidTotp = (ctx: Awaited<ReturnType<typeof buildCtx>>) => {
        ctx.mocks.redis.get.mockResolvedValue(makeBlob({ tenantId: 't-1' }));
        primeAttemptCounter(ctx.mocks.redis, 1);
        ctx.mocks.redis.getdel.mockResolvedValue(makeBlob({ tenantId: 't-1' }));
        ctx.repo.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
        ctx.totp.verify.mockResolvedValue(true);
        ctx.mocks.user.findById.mockResolvedValue(userFixture({ id: 'u-1', emailVerified: true }));
      };

      it('a member removed mid-challenge is refused even with a correct code', async () => {
        const ctx = await buildCtx();
        const { req, res } = reqWithCookie('rawtoken');
        primeValidTotp(ctx);
        ctx.mocks.prisma.client.user.findFirst.mockResolvedValue({
          lockedUntil: null,
          membershipEndedAt: new Date('2026-09-19'),
        });

        await expect(
          ctx.service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua'),
        ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED });

        // Consumed, so the same cookie cannot be replayed once the flag clears.
        expect(ctx.mocks.redis.getdel).toHaveBeenCalledTimes(1);
        expect(ctx.mocks.shared.establishSession).not.toHaveBeenCalled();
        // Checked before the counter reset, so a lock the challenge armed holds.
        expect(ctx.mocks.lockout.resetAttempts).not.toHaveBeenCalled();
        expect(ctx.mocks.audit.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
            userId: 'u-1',
            tenantId: 't-1',
            metadata: { reason: 'membership_ended', gate: 'session_mint' },
          }),
        );
        expect(ctx.mocks.audit.log).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_SUCCESS }),
        );
      });

      it('an account deleted mid-challenge is refused', async () => {
        const ctx = await buildCtx();
        const { req, res } = reqWithCookie('rawtoken');
        primeValidTotp(ctx);
        ctx.mocks.prisma.client.user.findFirst.mockResolvedValue(null);

        await expect(
          ctx.service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua'),
        ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED });
        expect(ctx.mocks.shared.establishSession).not.toHaveBeenCalled();
      });

      it('control: an account still eligible at verify gets its session', async () => {
        const ctx = await buildCtx();
        const { req, res } = reqWithCookie('rawtoken');
        primeValidTotp(ctx);

        await expect(
          ctx.service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua'),
        ).resolves.toMatchObject({ status: 'ok' });
        expect(ctx.mocks.shared.establishSession).toHaveBeenCalledTimes(1);
      });
    });

    it('corrupt pending blob reads as no challenge', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = reqWithCookie('rawtoken');
      mocks.redis.get.mockResolvedValue('{not valid json');

      await expect(
        service.verifyChallenge(req, res, { code: '123456' }, '1.1.1.1', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED });
      expect(mocks.redis.multi).not.toHaveBeenCalled();
    });
  });
});
