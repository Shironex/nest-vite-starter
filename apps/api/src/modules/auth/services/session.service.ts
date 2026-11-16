import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import Redis from 'ioredis';
import { AppErrorCode } from '@repo/shared/errors';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { UnauthorizedError } from '../../../common/errors';
import { sha256Hex } from '../../../common/utils/crypto';
import { nowMs } from '../../../common/clock';
import { TOKEN_ENTROPY_BYTES } from '../auth.constants';
import { recordAuthOutcome } from '../../metrics/auth-outcome.recorder';

const MAX_SESSIONS = 3;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const REMEMBER_ME_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
/**
 * TTL for the per-user epoch counter. It MUST outlive every session that
 * stamped it, or a session would outlive its own fence value: the counter would
 * expire back to 0 while a blob still carries epoch 3, and the mismatch would
 * log that user out early. One day of slack over the longest possible session
 * (remember-me), refreshed on every mint and every revoke, keeps the counter
 * strictly ahead of the newest session that references it.
 *
 * The failure direction if that invariant were ever broken is a forced
 * re-login, never a session that outlives its revocation.
 */
const EPOCH_TTL_SECONDS = REMEMBER_ME_TTL_SECONDS + 24 * 60 * 60;
/**
 * Only rewrite the session blob (to refresh lastActive) when the stored value
 * is more than this stale. Keeps the steady-state validate path a single GET
 * instead of a GET + SET per request.
 */
const LAST_ACTIVE_REFRESH_MS = 60 * 1000;

export interface ISessionData {
  userId: string;
  email: string;
  role: string;
  emailVerified: boolean;
  ip: string;
  userAgent: string;
  createdAt: number; // timestamp ms
  lastActive: number;
  expiresAt: number;
  /**
   * Session-epoch fence: the value of the user's epoch counter captured when
   * this session's authentication began. `validateSession` rejects the session
   * as soon as the counter moves past it, which is what makes a revocation
   * catch sessions the revocation walk itself could not see. Blobs written
   * before the fence existed have no epoch and read as 0.
   */
  epoch: number;
  /**
   * Active Tenant (organization) id for the session owner. Optional: pre-tenancy
   * sessions and platform/system contexts have no tenant; a user attached to a
   * organization carries it so AuthMiddleware can seed the ALS without a DB round-trip.
   */
  tenantId?: string | undefined;
  /**
   * Set when the session belongs to a member whose Organization requires 2FA and whose
   * grace has passed but who is not yet enrolled. The session-validating
   * middleware rejects everything except the enroll/logout allowlist with
   * TWO_FACTOR_ENROLLMENT_REQUIRED. Cleared by re-issuing the session on activate.
   */
  twoFactorEnrollmentRequired?: true | undefined;
}

/**
 * Validate the JSON blob read back from Redis. Redis is a trusted store, but a
 * corrupt/legacy/manually-edited entry must not silently become a half-populated
 * ISessionData that later null-derefs downstream: a bad entry is treated as no
 * session.
 */
const sessionDataSchema = z.object({
  userId: z.string(),
  email: z.string(),
  role: z.string(),
  emailVerified: z.boolean(),
  ip: z.string(),
  userAgent: z.string(),
  createdAt: z.number(),
  lastActive: z.number(),
  expiresAt: z.number(),
  // Absent on blobs written before the fence shipped; they read as epoch 0,
  // which equals the (missing) counter, so a deploy does not log everyone out.
  // The first revocation on the account moves the counter off 0 and fences
  // them exactly like a stamped blob.
  epoch: z.number().default(0),
  tenantId: z.string().optional(),
  twoFactorEnrollmentRequired: z.literal(true).optional(),
});

/** Extended session data returned from validateSession, includes the derived session ID. */
export interface IValidatedSession extends ISessionData {
  sessionId: string;
}

/** What a mint hands back: the cookie token, its expiry, and any session the
 * max-sessions cap evicted to make room for it. The evicted ids are the
 * caller's to act on (see `enforceMaxSessions`). */
export interface ICreatedSession {
  token: string;
  expiresAt: Date;
  evictedSessionIds: string[];
}

export interface ISessionInfo {
  sessionId: string;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastActive: number;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Hash a raw token to derive the session ID stored in Redis.
   * Cookie holds raw token; server hashes on lookup (prevents replay if Redis is compromised).
   */
  private hashToken(token: string): string {
    return sha256Hex(token);
  }

  /** Parse + validate a session blob; returns null for missing or corrupt data. */
  private parseSession(raw: string): ISessionData | null {
    try {
      return sessionDataSchema.parse(JSON.parse(raw));
    } catch {
      // Corrupt or schema-mismatched blobs read as "logged out" to the user;
      // without this line a deploy that tightens sessionDataSchema forces a
      // fleet-wide logout that is invisible in every log stream. Blob content
      // stays unlogged (it carries the session's identity claims).
      this.logger.warn('Session blob failed to parse; treating as invalid');
      return null;
    }
  }

  /**
   * Read the user's current session epoch. A missing counter is epoch 0.
   *
   * Callers that authenticate a user against stored state (a password hash, an
   * OAuth identity) must capture this BEFORE reading that state and pass it to
   * `createSession`, so the fence covers the whole authentication, not just the
   * Redis write. See the `epoch` param on `createSession` for why.
   */
  async readEpoch(userId: string): Promise<number> {
    return this.toEpoch(await this.redis.get(RedisKeys.sessionEpoch(userId)));
  }

  /** Coerce a raw counter value; anything unreadable (or missing) is epoch 0. */
  private toEpoch(raw: string | null): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Create a new session for a user.
   * Enforces max 3 concurrent sessions by evicting the oldest.
   * Returns the raw token (for cookie) and expiration date.
   */
  async createSession(params: {
    userId: string;
    email: string;
    role: string;
    emailVerified: boolean;
    ip: string;
    userAgent: string;
    rememberMe: boolean;
    tenantId?: string | undefined;
    twoFactorEnrollmentRequired?: true | undefined;
    /**
     * Session epoch captured by the caller BEFORE it read the state that
     * authenticates this login (see `readEpoch`). Stamped into the blob, and
     * re-checked here: if a revocation moved the counter in between, the mint
     * is rolled back and rejected rather than handed out.
     *
     * Omit it only when the mint cannot be racing a revocation of state it
     * already read: a brand-new account (register), or a flow that performs the
     * revocation itself and then re-issues (password change). Those read the
     * counter here instead, which fences the Redis write but not an earlier
     * credential read.
     */
    epoch?: number | undefined;
  }): Promise<ICreatedSession> {
    const { userId, email, role, emailVerified, ip, userAgent, rememberMe, tenantId } = params;
    const token = randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');
    const sessionId = this.hashToken(token);
    const ttl = rememberMe ? REMEMBER_ME_TTL_SECONDS : DEFAULT_TTL_SECONDS;
    const now = nowMs();
    const expiresAt = now + ttl * 1000;
    const epoch = params.epoch ?? (await this.readEpoch(userId));

    const sessionData: ISessionData = {
      userId,
      email,
      role,
      emailVerified,
      ip,
      userAgent,
      createdAt: now,
      lastActive: now,
      expiresAt,
      epoch,
    };
    // Conditional-assign (exactOptionalPropertyTypes): only carry tenantId when
    // present so pre-tenancy/platform sessions don't store `tenantId: undefined`.
    if (tenantId !== undefined) {
      sessionData.tenantId = tenantId;
    }
    // Only stamp the enrollment-required flag when set; a normal session must
    // never carry it (its presence is what the middleware gate keys on).
    if (params.twoFactorEnrollmentRequired) {
      sessionData.twoFactorEnrollmentRequired = true;
    }

    // Write membership + blob in ONE transaction, SADD logically first: a
    // failure between a lone SETEX and SADD would leave a valid session that
    // revocation (which walks the SET) can never find. The EXPIRE keeps an
    // abandoned account's SET from living forever; it is refreshed to the
    // longest possible session TTL on every new session, which is safe because
    // the SET is only a revocation/eviction index that is lazily cleaned of
    // stale members elsewhere.
    await this.redis
      .multi()
      .sadd(RedisKeys.userSessions(userId), sessionId)
      .expire(RedisKeys.userSessions(userId), REMEMBER_ME_TTL_SECONDS)
      .setex(RedisKeys.session(sessionId), ttl, JSON.stringify(sessionData))
      // Keep the fence counter alive for at least as long as the session that
      // just stamped it. A no-op while the user has never been revoked (EXPIRE
      // on a missing key does nothing), which is correct: absent reads as 0.
      .expire(RedisKeys.sessionEpoch(userId), EPOCH_TTL_SECONDS)
      .exec();

    // Second half of the fence: a revocation that landed between the epoch
    // capture and the write above has already emptied (or is emptying) the
    // user_sessions SET, and its walk cannot see a session added after its
    // SMEMBERS. Re-reading the counter here is what turns that survivor into a
    // failed login instead of a session that is merely dead-on-arrival at the
    // next validate. Rolling it back also keeps a fenced blob from occupying a
    // MAX_SESSIONS slot and evicting a live session.
    if ((await this.readEpoch(userId)) !== epoch) {
      await this.redis
        .pipeline()
        .del(RedisKeys.session(sessionId))
        .srem(RedisKeys.userSessions(userId), sessionId)
        .exec();
      this.logger.warn('Session mint lost the epoch fence; revoked mid-login', { userId });
      // Counted so a fence refusal is distinguishable from a Redis outage in
      // Prometheus: the audit trail records neither.
      recordAuthOutcome({ flow: 'session_mint', outcome: 'fence', kind: 'refusal', userId });
      throw new UnauthorizedError(
        AppErrorCode.SESSION_EXPIRED,
        'Your session expired, please log in again',
      );
    }

    // Enforce max sessions AFTER the new session exists. Checking before the
    // write let concurrent logins all pass the check and overshoot the max;
    // post-write enforcement converges the count to MAX_SESSIONS (the new
    // session has the newest createdAt, so oldest-first eviction never
    // evicts it while older candidates remain).
    const evictedSessionIds = await this.enforceMaxSessions(userId);

    return { token, expiresAt: new Date(expiresAt), evictedSessionIds };
  }

  /**
   * Validate a session token and return session data.
   * Refreshes the stored lastActive timestamp at most once per
   * LAST_ACTIVE_REFRESH_MS; the steady-state hot path is a single GET.
   */
  async validateSession(token: string): Promise<IValidatedSession | null> {
    const sessionId = this.hashToken(token);
    const key = RedisKeys.session(sessionId);
    const raw = await this.redis.get(key);

    if (!raw) {
      return null;
    }

    const session = this.parseSession(raw);
    if (!session) {
      return null;
    }

    // Expiry is enforced by the key TTL; the stored expiresAt is the backstop
    // for a key that somehow lost its TTL.
    const now = nowMs();
    if (session.expiresAt <= now) {
      return null;
    }

    // The fence. The counter has to be read here rather than pipelined with the
    // blob because its key is per-USER and the user id only exists once the
    // blob is parsed; one extra Redis GET per authenticated request is the
    // price of revocation that does not depend on the walk having found this
    // session. Strict inequality both ways: a blob ahead of the counter (a lost
    // or restored-from-backup counter) is just as untrustworthy as one behind
    // it, and both fail closed.
    if (session.epoch !== (await this.readEpoch(session.userId))) {
      return null;
    }

    if (now - session.lastActive > LAST_ACTIVE_REFRESH_MS) {
      session.lastActive = now;
      // Atomic update-if-exists (XX) with the TTL preserved (KEEPTTL). The
      // previous TTL-read + SETEX could resurrect a session revoked between
      // the reads, for its full remaining TTL, and outside the user_sessions
      // SET it was unrevokable. XX writes nothing when the key is gone.
      const written = await this.redis.set(key, JSON.stringify(session), 'KEEPTTL', 'XX');
      if (written === null) {
        // Session was revoked between the GET and the SET; treat as invalid.
        return null;
      }
    }

    return { ...session, sessionId };
  }

  /**
   * Delete a single session (logout current device).
   *
   * Deliberately does NOT bump the epoch: the counter is per-user, so bumping
   * it here would log every other device out too. Single-device logout deletes
   * exactly the blob it names, and the caller owns the token, so there is no
   * revocation walk to race.
   */
  async deleteSession(token: string): Promise<string> {
    const sessionId = this.hashToken(token);
    const raw = await this.redis.get(RedisKeys.session(sessionId));
    const session = raw ? this.parseSession(raw) : null;

    // Batch the removal: one SREM for the membership + one DEL for the blob.
    const pipeline = this.redis.pipeline();
    if (session) {
      pipeline.srem(RedisKeys.userSessions(session.userId), sessionId);
    }
    pipeline.del(RedisKeys.session(sessionId));
    await pipeline.exec();

    // The id the caller needs to close this session's sockets. Returned rather
    // than re-derived by the caller because `hashToken` is the one place that
    // knows how a cookie token becomes a session id, and a second copy of that
    // rule would be a second thing to keep in step.
    return sessionId;
  }

  /**
   * Revoke ONE of a user's sessions by its session ID (the Redis key id, i.e.
   * the hashed token): the self-service "sign out that device" path, where
   * the caller holds the LIST entry, not the raw token `deleteSession` needs.
   *
   * Ownership is the SET membership check: session ids are sha256 digests of
   * 32-byte-entropy tokens, so an id present in this user's SET was minted for
   * this user and can never be re-minted for another. A miss (someone else's
   * session, or one already reaped) deletes nothing and reports false.
   *
   * Same deliberate no-epoch semantics as `deleteSession`: bumping the
   * per-user counter here would log every other device out too. DEL + SREM
   * ride one MULTI so a crash cannot leave a valid blob outside the SET
   * (unfindable by the revocation walk and the sessions list).
   */
  async deleteUserSessionById(userId: string, sessionId: string): Promise<boolean> {
    const owned = await this.redis.sismember(RedisKeys.userSessions(userId), sessionId);
    if (!owned) {
      return false;
    }
    await this.redis
      .multi()
      .del(RedisKeys.session(sessionId))
      .srem(RedisKeys.userSessions(userId), sessionId)
      .exec();
    return true;
  }

  /**
   * Whether a session was minted with "remember me". Derived rather than
   * stored: the mint writes no flag, but only a remember-me session can span
   * more than the default TTL, so the created-to-expiry width is the flag.
   * Used by re-issue flows ("log out everywhere else") so replacing the
   * caller's session does not silently shorten a 30-day login to 24 hours.
   */
  isRememberMeSession(session: Pick<ISessionData, 'createdAt' | 'expiresAt'>): boolean {
    return session.expiresAt - session.createdAt > DEFAULT_TTL_SECONDS * 1000;
  }

  /**
   * Revoke every session for a user (logout all devices, password change/reset,
   * role change, account deletion, 2FA admin reset and enforcement sweep).
   *
   * The epoch bump comes FIRST and is the actual revocation; the walk below is
   * only the cleanup that reclaims the keys. That order is what closes the race
   * this method used to have with `createSession`:
   *
   *   - A mint whose epoch was captured before the bump stamps a stale value.
   *     It is rejected at `validateSession` (and refused outright by the
   *     mint-time re-check) even though the walk could not see it, because the
   *     walk's SMEMBERS ran before its SADD.
   *   - A mint whose epoch was captured after the bump is a post-revocation
   *     login and is allowed to live. Its SADD necessarily lands after the
   *     bump, so if the walk misses it, it stays in the SET and remains
   *     individually revokable.
   *   - A crash between the bump and the walk leaves every prior session
   *     invalid, not valid: the blobs survive but no longer match the counter.
   *     The reverse order would leave a crash window where sessions minted
   *     during the walk are never fenced at all.
   *
   * Callers must bump only AFTER the state change that motivates it has
   * committed (the new password hash, the new role), or a login that read the
   * old state could still capture the new epoch.
   */
  async deleteAllUserSessions(userId: string): Promise<void> {
    // INCR + EXPIRE in one round trip so a crash can never strand the counter
    // without a TTL (it would then outlive the account forever).
    await this.redis
      .multi()
      .incr(RedisKeys.sessionEpoch(userId))
      .expire(RedisKeys.sessionEpoch(userId), EPOCH_TTL_SECONDS)
      .exec();

    const sessionIds = await this.redis.smembers(RedisKeys.userSessions(userId));

    if (sessionIds.length > 0) {
      // SREM the ids that were actually walked instead of DEL-ing the whole
      // SET: a session added between the SMEMBERS above and this line is a
      // post-bump (legitimate) login, and DEL would strip it from the index
      // while leaving its blob alive, i.e. orphan it from "active sessions"
      // and from single-session logout. Redis drops the SET when it empties.
      await this.redis
        .pipeline()
        .del(...sessionIds.map((id) => RedisKeys.session(id)))
        .srem(RedisKeys.userSessions(userId), ...sessionIds)
        .exec();
    }
  }

  /**
   * Get all active sessions for a user.
   * Returns session metadata for the "active sessions" UI.
   */
  async getUserSessions(userId: string): Promise<ISessionInfo[]> {
    const active = await this.loadActiveSessions(userId);
    return active.map(({ sessionId, session }) => ({
      sessionId,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastActive: session.lastActive,
    }));
  }

  /**
   * Load every live session for a user in one round-trip batch: SMEMBERS once,
   * MGET all blobs, then a single SREM for any stale SET members whose key has
   * expired (or whose blob is unparseable or epoch-fenced). Shared by
   * getUserSessions and enforceMaxSessions, which previously duplicated a
   * sequential GET-per-id loop.
   */
  private async loadActiveSessions(
    userId: string,
  ): Promise<{ sessionId: string; session: ISessionData }[]> {
    const sessionIds = await this.redis.smembers(RedisKeys.userSessions(userId));
    if (sessionIds.length === 0) {
      return [];
    }

    const raws = await this.redis.mget(...sessionIds.map((id) => RedisKeys.session(id)));
    // Same fence validateSession applies, so a blob the walk failed to reap
    // neither shows up in the "active sessions" UI nor occupies a
    // MAX_SESSIONS slot that would evict a live session.
    const epoch = await this.readEpoch(userId);

    const active: { sessionId: string; session: ISessionData }[] = [];
    const stale: string[] = [];
    sessionIds.forEach((sessionId, i) => {
      const raw = raws[i];
      const session = raw ? this.parseSession(raw) : null;
      if (session && session.epoch === epoch) {
        active.push({ sessionId, session });
      } else {
        stale.push(sessionId);
      }
    });

    if (stale.length > 0) {
      // DEL alongside the SREM: an expired blob is already gone (no-op), but a
      // fenced one still holds a key that nothing will ever read again.
      await this.redis
        .pipeline()
        .del(...stale.map((id) => RedisKeys.session(id)))
        .srem(RedisKeys.userSessions(userId), ...stale)
        .exec();
    }

    return active;
  }

  /**
   * Enforce max concurrent sessions per user. Called AFTER the new session is
   * written, so concurrent logins converge to MAX_SESSIONS instead of
   * overshooting a pre-write check. Evicts the oldest sessions first; the
   * just-created session carries the newest createdAt, so it is only ever
   * evicted when everything else is newer.
   *
   * Returns the ids it evicted, so the AUTH-side caller can close their live
   * sockets. This service deliberately does not do that itself: EventsModule
   * imports SessionModule (the gateway authenticates sockets through it), so a
   * SessionService -> EventsService import would be a module cycle. That is the
   * same constraint SessionRevocationService exists for, and reporting the ids
   * keeps the eviction's knowledge here and the socket's over there.
   */
  private async enforceMaxSessions(userId: string): Promise<string[]> {
    const active = await this.loadActiveSessions(userId);
    if (active.length <= MAX_SESSIONS) {
      return [];
    }

    active.sort((a, b) => a.session.createdAt - b.session.createdAt);
    const toEvict = active.slice(0, active.length - MAX_SESSIONS);

    // Batch the eviction: one DEL for all blobs + one SREM for all members.
    const pipeline = this.redis.pipeline();
    pipeline.del(...toEvict.map(({ sessionId }) => RedisKeys.session(sessionId)));
    pipeline.srem(RedisKeys.userSessions(userId), ...toEvict.map(({ sessionId }) => sessionId));
    await pipeline.exec();

    this.logger.debug('Evicted oldest sessions over the cap', {
      userId,
      evicted: toEvict.length,
    });

    return toEvict.map(({ sessionId }) => sessionId);
  }
}
