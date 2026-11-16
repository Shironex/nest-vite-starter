/**
 * Centralized Redis key construction. Every Redis key produced inside the
 * API must come through this helper so:
 *   - A prefix retrofit can wrap a single layer without grepping the
 *     codebase for ad-hoc string literals.
 *   - A cache-manager adoption can extend the same builders rather than
 *     re-implement key shape per call site.
 *   - Naming conventions stay consistent (separator, casing, ordering).
 */

/** Top-level prefixes. Keep in sync with operational dashboards / Redis SCAN
 * scripts that expect these literals. */
export const REDIS_KEY_PREFIXES = {
  SESSION: 'session',
  USER_SESSIONS: 'user_sessions',
  SESSION_EPOCH: 'session_epoch',
  RATE_LIMIT: 'ratelimit',
  // 2FA: all cookie-borne tokens are stored keyed by sha256(token), mirroring
  // `session`; the `*_USER` / `*_DEVICES` SETs index a user's records for
  // revocation walks, mirroring `user_sessions`.
  TWOFA_PENDING: 'twofa_pending',
  TWOFA_PENDING_USER: 'twofa_pending_user',
  TRUSTED_DEVICE: 'trusted_device',
  TRUSTED_DEVICES: 'trusted_devices',
  TWOFA_USED: 'twofa_used',
  // Pending email change: the link-borne token is stored keyed by
  // sha256(token), mirroring `session`; the `*_USER` key indexes the one live
  // pending change per user for replace-on-new-request and for the
  // credential-rotation invalidation walk.
  EMAIL_CHANGE: 'email_change',
  EMAIL_CHANGE_USER: 'email_change_user',
  // One claim per cron sweep per app-zone day. @Cron fires on EVERY replica, so a
  // sweep with a side effect and no row to compare-and-swap on needs a claim of
  // its own or it runs once per replica.
  CRON_TICK: 'cron_tick',
} as const;

const SEP = ':';

export const RedisKeys = {
  /** Per-session record keyed by sha256(token). Holds the full ISessionData blob. */
  session: (sessionId: string): string => `${REDIS_KEY_PREFIXES.SESSION}${SEP}${sessionId}`,

  /** SET of sessionIds owned by `userId`. Used to enforce max-sessions and
   * for "log out all devices". */
  userSessions: (userId: string): string => `${REDIS_KEY_PREFIXES.USER_SESSIONS}${SEP}${userId}`,

  /**
   * Session-epoch fence counter for `userId`: a monotonic integer INCR'd by
   * every revoke-all (password change/reset, role change, forced logout,
   * account deletion, 2FA admin reset / enforcement sweep) and stamped into
   * each session blob at mint time. `validateSession` rejects any blob whose
   * stamped epoch is not the current one.
   *
   * This is what makes revocation reliable rather than best-effort: the
   * `user_sessions` SET walk can only delete the sessions it can SEE, so a
   * session minted concurrently with the walk survives it. The epoch is a
   * single value that invalidates every session minted before the bump,
   * whether or not the walk found it, and whether or not the walk finished.
   *
   * A missing key reads as epoch 0, so sessions minted before this fence
   * existed stay valid until the account's first revocation (no deploy-time
   * fleet-wide logout).
   */
  sessionEpoch: (userId: string): string => `${REDIS_KEY_PREFIXES.SESSION_EPOCH}${SEP}${userId}`,

  /** Fixed-window rate-limit counter, e.g. `ratelimit:login:1.2.3.4`. */
  rateLimit: (scope: string): string => `${REDIS_KEY_PREFIXES.RATE_LIMIT}${SEP}${scope}`,

  /**
   * Pre-2FA "half logged in" pending record, keyed by sha256(pendingToken).
   * Holds the zod-validated login snapshot; consumed via GETDEL on successful
   * verify so two racing verifies cannot both establish a session. TTL 300 s.
   */
  twoFactorPending: (pendingId: string): string =>
    `${REDIS_KEY_PREFIXES.TWOFA_PENDING}${SEP}${pendingId}`,

  /**
   * SET of pending ids owned by `userId`, so admin reset / lockout can
   * best-effort invalidate a user's in-flight challenges. Same 300 s expiry
   * discipline as the pending records themselves.
   */
  twoFactorPendingUser: (userId: string): string =>
    `${REDIS_KEY_PREFIXES.TWOFA_PENDING_USER}${SEP}${userId}`,

  /**
   * Pending email-change record, keyed by sha256(rawToken) so a Redis dump
   * cannot be replayed as a confirmation link. Holds `{ userId, newEmail }`;
   * consumed via GETDEL on confirm so two racing confirmations cannot both
   * flip the address. TTL EMAIL_CHANGE_TOKEN_TTL_MS.
   */
  emailChange: (tokenHash: string): string =>
    `${REDIS_KEY_PREFIXES.EMAIL_CHANGE}${SEP}${tokenHash}`,

  /**
   * The token hash of `userId`'s one live pending email change (a plain
   * STRING, not a SET: a new request replaces the previous one, mirroring the
   * DB TokenService's delete-then-create). Walked by password change/reset to
   * kill a pending change when the credential rotates.
   */
  emailChangeUser: (userId: string): string =>
    `${REDIS_KEY_PREFIXES.EMAIL_CHANGE_USER}${SEP}${userId}`,

  /**
   * Trusted-device ("remember this browser") record, keyed by sha256(token).
   * Holds `{ userId, createdAt, ip, userAgent }`; the userId match is
   * load-bearing (a browser trusted for user A must never skip user B's
   * challenge). TTL 30 d fixed.
   */
  trustedDevice: (deviceId: string): string =>
    `${REDIS_KEY_PREFIXES.TRUSTED_DEVICE}${SEP}${deviceId}`,

  /** SET of trusted-device ids owned by `userId`; walked for revoke-all and the
   * oldest-first cap of 5. Same SADD-first discipline as `user_sessions`. */
  trustedDevices: (userId: string): string =>
    `${REDIS_KEY_PREFIXES.TRUSTED_DEVICES}${SEP}${userId}`,

  /**
   * TOTP replay guard, SETNX-claimed after a code validates so the same code
   * cannot be reused inside its window. `counter` is the TOTP step index (the
   * validated slot), so distinct codes never collide. TTL 90 s.
   */
  twoFactorUsed: (userId: string, counter: number): string =>
    `${REDIS_KEY_PREFIXES.TWOFA_USED}${SEP}${userId}${SEP}${counter}`,

  /**
   * One replica's claim on one day's run of one cron sweep.
   *
   * `@Cron` schedules inside every process, so a three-replica deployment runs
   * every sweep three times. Most sweeps here do not care: they act on rows
   * through a compare-and-swap, so the second and third replicas find nothing
   * left to do and write nothing. A sweep whose subject is an OBJECT with no row
   * behind it has no such gate, and a duplicate run there means a duplicate
   * side effect and a duplicate audit row.
   *
   * Keyed by the calendar day in the app time zone (`APP_TIME_ZONE`), so the
   * claim reads as "today's run" rather than as a lease whose expiry has to be
   * reasoned about, and so it rolls at local midnight with the rest of the
   * app's calendar-date math.
   */
  cronSweepTick: (sweep: string, appDay: string): string =>
    `${REDIS_KEY_PREFIXES.CRON_TICK}${SEP}${sweep}${SEP}${appDay}`,
} as const;
