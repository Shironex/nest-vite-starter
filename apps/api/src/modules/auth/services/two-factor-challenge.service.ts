import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import type { VerifyTwoFactorInput } from '@repo/shared/schemas';
import { UnauthorizedError, ValidationError } from '../../../common/errors';
import { PrismaService } from '../../../common/database/prisma.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { sha256Hex } from '../../../common/utils/crypto';
import { nowMs } from '../../../common/clock';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { UserService, type IUserProfile } from '../../user/user.service';
import {
  MAX_VERIFY_ATTEMPTS_PER_PENDING,
  PENDING_CHALLENGE_TTL_SECONDS,
  TOKEN_ENTROPY_BYTES,
  getTwoFactorPendingCookieName,
} from '../auth.constants';
import { AuthSharedService, type IEstablishSessionParams } from './auth-shared.service';
import { LockoutService } from './lockout.service';
import { StepUpService } from './step-up.service';
import type { SecondFactorMethod } from './step-up.service';
import { TrustedDeviceService } from './trusted-device.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import {} from '../two-factor.util';
import { recordAuthOutcome } from '../auth-outcome.recorder';

/** Snapshot of the just-authenticated user handed to the seam (transport-agnostic). */
export interface IChallengeUser {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
  tenantId?: string | null | undefined;
}

export interface IChallengeOptions {
  rememberMe: boolean;
  ip: string;
  userAgent: string;
  /**
   * Session epoch captured by the caller BEFORE it read the state that
   * authenticated this user (the password hash);
   * see `SessionService.readEpoch`. It rides through to `createSession`, and
   * through the pending record when a second factor is required, so a
   * revocation anywhere between "we read the credential" and "we hand out a
   * cookie" invalidates the login instead of racing it.
   *
   * A caller that omits it still gets the fence, but only from the moment
   * `createSession` runs, which leaves its own credential read unfenced. Every
   * password-verifying entry point passes it, and any new one must too.
   */
  epoch?: number | undefined;
}

/**
 * Outcome of the post-credential decision. `via` on the session arm tells the
 * password caller whether to also emit its own login-success audit: a pure
 * no-factor login does, a trusted-device short-circuit does not (the seam
 * already audited the 2FA challenge success for it).
 */
export type BeginOrEstablishResult =
  | { kind: 'session'; expiresAt: Date; via: 'no_factor' | 'trusted_device' }
  | { kind: 'challenge'; methods: string[] };

/**
 * Why the mint gate refused an account, read live from the database. Also the
 * audit and metric reason, spelled like the per-door refusals it backs up.
 */
type SessionIneligibleReason = 'account_deleted' | 'account_locked' | 'membership_ended';

/** Discriminated login result shared by password login and 2FA verify. */
export type ILoginResult =
  | { status: 'ok'; user: IUserProfile; requiresVerification: boolean }
  | { status: 'twofa_required'; methods: string[] };

/**
 * Pending-challenge blob, zod-validated on read exactly like session data: a
 * corrupt blob reads as "no pending challenge" and routes back to login.
 */
const pendingChallengeSchema = z.object({
  userId: z.string(),
  email: z.string(),
  role: z.string(),
  emailVerified: z.boolean(),
  tenantId: z.string().optional(),
  ip: z.string(),
  userAgent: z.string(),
  rememberMe: z.boolean(),
  createdAt: z.number(),
  // Fence value captured at password verify. Carried across the challenge so a
  // revocation during the (up to 300 s) 2FA step invalidates the login it was
  // authorizing: the pending record is not a session, but the session it
  // eventually mints must not predate the revocation. Optional so a record
  // written by the previous deploy still parses (it fences from mint instead).
  epoch: z.number().optional(),
});
type PendingChallenge = z.infer<typeof pendingChallengeSchema>;

/**
 * The single post-credential chokepoint for every login. `beginOrEstablish` either establishes a session directly (no active
 * factor, or a valid trusted device) or mints a short-lived pending record and
 * returns a challenge; `verifyChallenge` consumes that record. No session ever
 * exists until a factor is satisfied, and `establishSession` is only ever
 * reached through this service (enforced by the Step 7 lint rule).
 *
 * Being that chokepoint, it is also where the session-epoch fence enters the
 * login: callers hand in the epoch they captured before reading the credential
 * (`IChallengeOptions.epoch`) and the seam carries it to the mint, directly or
 * through the pending record. A new entry point that skips it still gets a
 * fenced session, just one whose fence starts later than its credential read.
 *
 * It is also where live account state is re-checked. Every entry point runs its
 * own deleted / locked / removed-member checks for an accurate audit reason,
 * but those read a snapshot and each door has to remember the whole list. `findIneligibleReason` re-reads
 * the three fields right before anything is minted, here and again before the
 * post-challenge mint, so a door that forgets one, or a state change that lands
 * mid-login, still ends without a session.
 */
@Injectable()
export class TwoFactorChallengeService {
  private readonly logger = new Logger(TwoFactorChallengeService.name);
  private readonly pendingCookieName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly shared: AuthSharedService,
    private readonly lockoutService: LockoutService,
    private readonly stepUpService: StepUpService,
    private readonly trustedDeviceService: TrustedDeviceService,
    private readonly secondFactorRepository: SecondFactorRepository,
    private readonly userService: UserService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly prismaService: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.pendingCookieName = getTwoFactorPendingCookieName(
      this.configService.get<string>('NODE_ENV') === 'production',
    );
  }

  /**
   * Post-credential decision. If the user has no active non-recovery factor,
   * establish the session as before. Otherwise mint a pending record + the
   * `__Host-2fa` cookie and return a challenge: NO session, NO CSRF rotation
   * yet (the auth state has not changed until the second factor is verified).
   *
   * Trusted-device short-circuit and enforcement-flag stamping are layered in by
   * Steps 4 and 5 respectively; the seam shape does not change.
   */
  async beginOrEstablish(
    req: Request,
    res: Response,
    user: IChallengeUser,
    opts: IChallengeOptions,
  ): Promise<BeginOrEstablishResult> {
    // Before the challenge as well as the session: an ineligible account must
    // not be handed a pending record it could spend a factor on either.
    const ineligible = await this.findIneligibleReason(user.id);
    if (ineligible !== null) {
      await this.refuseIneligible(
        user.id,
        user.tenantId ?? null,
        ineligible,
        opts.ip,
        opts.userAgent,
      );
      // The password door's own refusal, so a state change racing the login
      // is indistinguishable from a wrong password.
      throw new UnauthorizedError(AppErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    const activeFactor = await this.secondFactorRepository.findActiveNonRecovery(user.id);
    if (!activeFactor) {
      const session = await this.shared.establishSession(req, res, this.sessionParams(user, opts));
      return { kind: 'session', expiresAt: session.expiresAt, via: 'no_factor' };
    }

    // A browser trusted for THIS user skips the challenge. The userId match is
    // load-bearing: a device trusted for user A must never skip user B.
    if (await this.trustedDeviceService.isTrusted(req, user.id)) {
      const session = await this.shared.establishSession(req, res, this.sessionParams(user, opts));
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_SUCCESS,
        userId: user.id,
        // Stamped explicitly: the challenge runs before AuthMiddleware seeds
        // the ALS, and a tenant-less row is attributed through the actor's
        // CURRENT tenant, so it would follow the account into a later organization.
        tenantId: user.tenantId ?? null,
        targetType: 'User',
        targetId: user.id,
        ipAddress: opts.ip,
        userAgent: opts.userAgent,
        metadata: { method: 'trusted_device' },
      });
      recordAuthOutcome({
        flow: 'twofa_challenge',
        outcome: 'trusted_device',
        kind: 'success',
        userId: user.id,
      });
      return { kind: 'session', expiresAt: session.expiresAt, via: 'trusted_device' };
    }

    await this.mintPending(req, res, user, opts);
    return { kind: 'challenge', methods: ['TOTP'] };
  }

  private sessionParams(user: IChallengeUser, opts: IChallengeOptions): IEstablishSessionParams {
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      ip: opts.ip,
      userAgent: opts.userAgent,
      rememberMe: opts.rememberMe,
      tenantId: user.tenantId,
      epoch: opts.epoch,
    };
  }

  /**
   * Verify a submitted second-factor code against the pending record. On
   * success establishes the session (rotating CSRF), consumes the record, and
   * returns the login-success arm. Failures bump the per-account lockout and
   * the per-pending attempt budget; the 6th attempt destroys the record.
   */
  async verifyChallenge(
    req: Request,
    res: Response,
    input: VerifyTwoFactorInput,
    ip: string,
    userAgent: string,
  ): Promise<ILoginResult> {
    // Layer 3: per-IP envelope, same as login/register/forgot-password.
    await this.shared.enforceAuthRateLimit('2fa', ip);

    const token = req.cookies?.[this.pendingCookieName] as string | undefined;
    if (!token) {
      throw this.challengeExpired();
    }
    const pendingId = sha256Hex(token);
    const raw = await this.redis.get(RedisKeys.twoFactorPending(pendingId));
    const pending = raw ? this.parsePending(raw) : null;
    if (!pending) {
      // Corrupt or already-gone record: nothing to attribute, route to login.
      this.shared.clearAuthCookie(res, this.pendingCookieName);
      throw this.challengeExpired();
    }

    // Layer 1: per-pending attempt budget. The Nth+1 attempt destroys the
    // record. INCR + EXPIRE NX run in one MULTI/EXEC so a crash can never strand
    // the counter without a TTL (which would lock the pending record forever).
    const attemptKey = RedisKeys.rateLimit(`2fa:${pendingId}`);
    const replies = await this.redis
      .multi()
      .incr(attemptKey)
      .expire(attemptKey, PENDING_CHALLENGE_TTL_SECONDS, 'NX')
      .exec();
    const [incrError, attemptCount] = replies?.[0] ?? [null, 0];
    if (incrError) {
      throw incrError;
    }
    const attempts = Number(attemptCount);
    if (attempts > MAX_VERIFY_ATTEMPTS_PER_PENDING) {
      await this.consumePending(pendingId, pending.userId);
      this.shared.clearAuthCookie(res, this.pendingCookieName);
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_2FA_LOCKED,
        userId: pending.userId,
        tenantId: pending.tenantId ?? null,
        targetType: 'User',
        targetId: pending.userId,
        success: false,
        ipAddress: ip,
        userAgent,
        metadata: { reason: 'rate_limited' },
      });
      recordAuthOutcome({
        flow: 'twofa_challenge',
        outcome: 'rate_limited',
        kind: 'refusal',
        userId: pending.userId,
      });
      throw this.challengeExpired();
    }

    const method = await this.verifyCode(pending.userId, input.code);
    if (!method) {
      // Layer 2: feed the per-account escalating lockout, exactly like a bad
      // password. A sustained 2FA guess locks the account.
      await this.lockoutService.recordFailedAttempt(pending.userId);
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_FAILURE,
        userId: pending.userId,
        tenantId: pending.tenantId ?? null,
        targetType: 'User',
        targetId: pending.userId,
        success: false,
        ipAddress: ip,
        userAgent,
        metadata: { reason: 'bad_code' },
      });
      recordAuthOutcome({
        flow: 'twofa_challenge',
        outcome: 'bad_code',
        kind: 'refusal',
        userId: pending.userId,
      });
      throw new ValidationError(AppErrorCode.TWO_FACTOR_INVALID_CODE, 'Invalid code');
    }

    // Single-use: GETDEL is the atomic gate. If a concurrent verify already
    // consumed the record, this one must not establish a second session.
    const consumed = await this.consumePending(pendingId, pending.userId);
    if (!consumed) {
      throw this.challengeExpired();
    }
    this.shared.clearAuthCookie(res, this.pendingCookieName);

    // The account may have been removed, deleted or locked during the (up to
    // 300 s) challenge. Checked after the record is consumed, so a refusal
    // cannot be retried with the same cookie, and before resetAttempts, so a
    // lock the challenge itself armed is still in force when it is read.
    const ineligible = await this.findIneligibleReason(pending.userId);
    if (ineligible !== null) {
      await this.refuseIneligible(
        pending.userId,
        pending.tenantId ?? null,
        ineligible,
        ip,
        userAgent,
      );
      throw this.challengeExpired();
    }

    await this.lockoutService.resetAttempts(pending.userId);

    // Trusted-device minting on input.trustDevice is added in Step 4.

    await this.shared.establishSession(req, res, {
      userId: pending.userId,
      email: pending.email,
      role: pending.role,
      emailVerified: pending.emailVerified,
      ip,
      userAgent,
      rememberMe: pending.rememberMe,
      tenantId: pending.tenantId,
      // The epoch from the PASSWORD step, not from now: the credential this
      // session rests on was read back then, so that is the moment the fence
      // has to cover. A revocation during the challenge therefore fails the
      // verify with SESSION_EXPIRED instead of minting a session that predates
      // the revocation.
      epoch: pending.epoch,
    });

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_SUCCESS,
      userId: pending.userId,
      tenantId: pending.tenantId ?? null,
      targetType: 'User',
      targetId: pending.userId,
      ipAddress: ip,
      userAgent,
      metadata: { method },
    });
    recordAuthOutcome({
      flow: 'twofa_challenge',
      outcome: 'success',
      kind: 'success',
      userId: pending.userId,
    });

    // A recovery code being spent is a high-signal account-security event: audit
    // it distinctly and notify the account.
    if (method === 'recovery') {
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_2FA_RECOVERY_USED,
        userId: pending.userId,
        tenantId: pending.tenantId ?? null,
        targetType: 'User',
        targetId: pending.userId,
        ipAddress: ip,
        userAgent,
      });
      try {
        await this.mailService.sendRecoveryCodeUsedEmail(pending.email);
      } catch (error) {
        this.logger.error('Failed to send recovery-code-used email', error);
      }
    }

    if (input.trustDevice) {
      await this.trustedDeviceService.trust(req, res, pending.userId, ip, userAgent);
    }

    const profile = await this.loadProfile(pending.userId);
    return { status: 'ok', user: profile, requiresVerification: !pending.emailVerified };
  }

  /**
   * Live read of the three states that forbid a new session. A soft-deleted
   * row reads as missing (the where clause excludes it), and a missing row is
   * refused the same way: there is nobody to mint a session for.
   *
   * Runs before AuthMiddleware seeds the ALS, keyed by the userId the caller
   * authenticated: `User` is
   * platform-global, so the tenant extension does not filter it and the
   * request client answers without a tenant in context.
   */
  private async findIneligibleReason(userId: string): Promise<SessionIneligibleReason | null> {
    const user = await this.prismaService.client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { lockedUntil: true, membershipEndedAt: true },
    });
    if (!user) {
      return 'account_deleted';
    }
    if (this.lockoutService.isLockedFromUser(user).locked) {
      return 'account_locked';
    }
    if (user.membershipEndedAt !== null) {
      return 'membership_ended';
    }
    return null;
  }

  /**
   * Trail and count a mint-gate refusal. Explicit tenantId for the same reason
   * as the trusted-device row: nothing has seeded the ALS yet.
   */
  private async refuseIneligible(
    userId: string,
    tenantId: string | null,
    reason: SessionIneligibleReason,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
      userId,
      tenantId,
      targetType: 'User',
      targetId: userId,
      success: false,
      ipAddress: ip,
      userAgent,
      metadata: { reason, gate: 'session_mint' },
    });
    recordAuthOutcome({ flow: 'session_mint', outcome: reason, kind: 'refusal', userId });
  }

  /**
   * Classify the submitted code by shape and verify it, delegated to the one
   * implementation in StepUpService. This flow's own gate (per-IP envelope,
   * pending-challenge attempt budget, trusted-device mint) stays here; only the
   * shape dispatch is shared, because a change to recovery-code redemption or
   * the TOTP replay rule must land in one place.
   */
  private async verifyCode(userId: string, code: string): Promise<SecondFactorMethod | null> {
    return this.stepUpService.verifyCode(userId, code);
  }

  private async mintPending(
    req: Request,
    res: Response,
    user: IChallengeUser,
    opts: IChallengeOptions,
  ): Promise<void> {
    const token = randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');
    const pendingId = sha256Hex(token);
    const blob: PendingChallenge = {
      userId: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      tenantId: user.tenantId ?? undefined,
      ip: opts.ip,
      userAgent: opts.userAgent,
      rememberMe: opts.rememberMe,
      createdAt: nowMs(),
      epoch: opts.epoch,
    };
    // SADD-first (logically) so a crash cannot leave a record the revocation
    // walk can never find; the record then dies with the 300 s TTL regardless.
    await this.redis
      .multi()
      .sadd(RedisKeys.twoFactorPendingUser(user.id), pendingId)
      .expire(RedisKeys.twoFactorPendingUser(user.id), PENDING_CHALLENGE_TTL_SECONDS)
      .setex(
        RedisKeys.twoFactorPending(pendingId),
        PENDING_CHALLENGE_TTL_SECONDS,
        JSON.stringify(blob),
      )
      .exec();
    this.shared.setAuthCookie(
      res,
      this.pendingCookieName,
      token,
      PENDING_CHALLENGE_TTL_SECONDS * 1000,
    );
  }

  /** GETDEL the pending record + drop it from the user index. Returns the value. */
  private async consumePending(pendingId: string, userId: string): Promise<string | null> {
    const value = await this.redis.getdel(RedisKeys.twoFactorPending(pendingId));
    await this.redis.srem(RedisKeys.twoFactorPendingUser(userId), pendingId);
    return value;
  }

  private parsePending(raw: string): PendingChallenge | null {
    try {
      return pendingChallengeSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async loadProfile(userId: string): Promise<IUserProfile> {
    const user = await this.userService.findById(userId);
    if (!user) {
      // The account vanished between the pending mint and verify.
      throw this.challengeExpired();
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };
  }

  /** The pending record is gone (expired or attempts exhausted): route to login. */
  private challengeExpired(): UnauthorizedError {
    return new UnauthorizedError(
      AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED,
      'Your session expired, please log in again',
    );
  }
}
