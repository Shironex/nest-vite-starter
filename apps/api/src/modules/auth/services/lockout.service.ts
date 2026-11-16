import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AuditService } from '../../audit/audit.service';
import { LockoutRepository } from '../repositories/lockout.repository';
import { now, nowMs } from '../../../common/clock';
import { ForbiddenError, NotFoundError } from '../../../common/errors';
import { getTenantId } from '../../../common/context/request-context';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';

const MAX_FAILED_ATTEMPTS = 5;

// Progressive lockout durations in milliseconds
const LOCKOUT_DURATIONS_MS: Record<number, number> = {
  0: 5 * 60 * 1000, // 1st lockout: 5 minutes
  1: 15 * 60 * 1000, // 2nd lockout: 15 minutes
  2: 60 * 60 * 1000, // 3rd lockout: 1 hour
};

/**
 * How long a Redis attempt reservation lives, in seconds.
 *
 * Deliberately the SHORTEST lockout tier (5 minutes, `LOCKOUT_DURATIONS_MS[0]`)
 * and no longer. The Redis counter is an admission gate, not a second lockout:
 * `applyLockout` zeroes the row's `failedAttempts` when it locks, so a window
 * that outlived the tier it armed would keep refusing after the DB lock had
 * lifted and quietly turn a five-minute lockout into a longer one. Matching the
 * shortest tier means the window has always drained by the time the account is
 * unlocked, on every tier.
 *
 * It cannot let more through than the row would, either: the row's counter only
 * resets on a lockout or a successful login, so once the budget is spent the DB
 * lock is what refuses, whatever the Redis key says.
 */
const ATTEMPT_WINDOW_SECONDS = 5 * 60;

/** The admission reservation's Redis key. Shape mirrors the 2FA per-pending
 * attempt budget (`RedisKeys.rateLimit('2fa:<pendingId>')`). */
const attemptKey = (userId: string): string => RedisKeys.rateLimit(`lockout:${userId}`);

// lockoutCount >= 3: permanent lock (requires admin unlock)
const PERMANENT_LOCK_DATE = new Date('9999-12-31T23:59:59Z');

@Injectable()
export class LockoutService {
  constructor(
    private readonly lockoutRepository: LockoutRepository,
    private readonly auditService: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Reserve one password attempt for `userId` and report whether the account is
   * still inside its budget. Call this BEFORE the credential is evaluated.
   *
   * `isLockedFromUser` reads `lockedUntil` off the row the request already
   * fetched, so every request that starts before the fifth failure COMMITS
   * passes it. Under a parallel burst the 5-attempt budget therefore bounded
   * nothing but the number of requests in flight during one argon2 window: an
   * attacker with enough addresses and solved challenges got many guesses per
   * lockout round instead of five, and again at every tier. Counting after the
   * verify is what made that possible; reserving before it is the fix.
   *
   * `INCR` plus `EXPIRE ... NX` in one `MULTI`, exactly like the 2FA
   * per-pending budget: the INCR is the reservation, and NX means counting
   * never extends the window, so a burst cannot push its own deadline out. One
   * MULTI so a crash can never strand the counter without a TTL, which would
   * lock the account out until somebody found the key by hand.
   *
   * The DB row stays the history: it drives the progressive tiers and the admin
   * unlock. This is only the admission gate.
   */
  async reserveAttempt(userId: string): Promise<{ withinBudget: boolean }> {
    const key = attemptKey(userId);
    const replies = await this.redis
      .multi()
      .incr(key)
      .expire(key, ATTEMPT_WINDOW_SECONDS, 'NX')
      .exec();
    const [incrError, reserved] = replies?.[0] ?? [null, 0];
    if (incrError) {
      throw incrError;
    }
    return { withinBudget: Number(reserved) <= MAX_FAILED_ATTEMPTS };
  }

  /**
   * Check if a user account is currently locked (reads lockedUntil from the
   * DB). Callers that already hold the user row should use isLockedFromUser
   * instead and skip the extra read.
   */
  async isLocked(userId: string): Promise<{ locked: boolean; lockedUntil?: Date }> {
    const user = await this.lockoutRepository.getLockoutState(userId);
    if (!user) {
      throw new NotFoundError();
    }
    return this.isLockedFromUser(user);
  }

  /**
   * Evaluate lockout from an already-loaded row (e.g. the login flow's
   * credential fetch, which carries lockedUntil anyway). Owned here so the
   * lockout comparison lives in exactly one place.
   */
  isLockedFromUser(user: { lockedUntil: Date | null }): { locked: boolean; lockedUntil?: Date } {
    if (user.lockedUntil && user.lockedUntil > now()) {
      return { locked: true, lockedUntil: user.lockedUntil };
    }

    return { locked: false };
  }

  /**
   * Record a failed login attempt and potentially lock the account.
   * Implements progressive lockout: 5min -> 15min -> 1hr -> admin unlock.
   *
   * Returns whether the account is now locked and remaining attempts before lock.
   */
  async recordFailedAttempt(
    userId: string,
  ): Promise<{ locked: boolean; attemptsRemaining: number }> {
    // Atomically increment failedAttempts (guarded: null when the user does
    // not exist or is soft-deleted).
    const user = await this.lockoutRepository.incrementFailedAttempts(userId);
    if (!user) {
      throw new NotFoundError();
    }

    if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      // Determine lockout duration based on lockoutCount
      const lockoutDuration = LOCKOUT_DURATIONS_MS[user.lockoutCount];
      const lockedUntil =
        lockoutDuration !== undefined ? new Date(nowMs() + lockoutDuration) : PERMANENT_LOCK_DATE; // lockoutCount >= 3: permanent

      await this.lockoutRepository.applyLockout(userId, lockedUntil);

      return { locked: true, attemptsRemaining: 0 };
    }

    return {
      locked: false,
      attemptsRemaining: MAX_FAILED_ATTEMPTS - user.failedAttempts,
    };
  }

  /**
   * Reset failed attempts on successful login.
   * Does NOT reset lockoutCount (progressive across lockouts).
   *
   * Drops the Redis reservation alongside the row, in this one place rather
   * than at the call site: a successful login that cleared the row but left the
   * counter would spend the rest of the window refusing a person who had just
   * proved they own the account.
   */
  async resetAttempts(userId: string): Promise<void> {
    await this.lockoutRepository.resetAttempts(userId);
    await this.redis.del(attemptKey(userId));
  }

  /**
   * Full admin unlock: resets all lockout state.
   *
   * Tenant containment: the `User` model is platform-global, so an admin in
   * organization A must not be able to unlock a user in organization B. The reset is scoped
   * to the caller's active tenant (from the ALS); a cross-tenant `userId`
   * matches zero rows and throws NotFound. Fails closed: a missing tenant in
   * context throws Forbidden rather than unlocking across all tenants.
   *
   * AUDITED, because the other half of this story already is. The failed logins
   * that ARM the lockout write their own rows (auth.login.failure,
   * auth.login.locked); without this one the trail shows an account being
   * attacked and then simply working again, with nothing in between naming the
   * person who released it. And a full reset is more than opening the door once:
   * it zeroes `lockoutCount`, putting an account that reached the permanent
   * tier back on the five-minute rung, so the state it erases is the part of
   * the row worth keeping.
   */
  async adminUnlock(userId: string): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError();
    }

    // Snapshot before the reset: `fullReset` is an updateMany and cannot return
    // the values it overwrites, so this is the last moment they exist. Same
    // tenant fence as the reset, so a cross-tenant id is refused here.
    const previous = await this.lockoutRepository.getAdminUnlockState(userId, tenantId);
    if (!previous) {
      throw new NotFoundError();
    }

    const count = await this.lockoutRepository.fullReset(userId, tenantId);
    if (count === 0) {
      // Deleted or moved tenant between the probe and the reset.
      throw new NotFoundError();
    }

    // An unlock that left the admission reservation standing would not be an
    // unlock: the row says the door is open and the counter still refuses at
    // it. Cleared for the same reason `resetAttempts` clears it.
    await this.redis.del(attemptKey(userId));

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_LOCKOUT_ADMIN_CLEARED,
      targetType: 'User',
      targetId: userId,
      before: {
        lockoutCount: previous.lockoutCount,
        failedAttempts: previous.failedAttempts,
        lockedUntil: previous.lockedUntil?.toISOString() ?? null,
      },
    });
  }
}
