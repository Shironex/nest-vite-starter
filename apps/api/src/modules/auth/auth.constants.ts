/**
 * Name of the HTTP-only session cookie. Single source of truth shared by the
 * cookie writers (AuthSharedService), the tRPC AuthMiddleware, and the
 * Socket.io handshake guard (EventsGateway) so the name can never drift.
 *
 * In production the name carries the `__Host-` prefix, which the browser only
 * accepts on a Secure, Path=/, no-Domain cookie. That binds the cookie to the
 * exact host: a subdomain (or an http origin) can neither set nor overwrite
 * it, closing session-fixation via cookie tossing. Dev/test stay on the bare
 * name because the prefix requires Secure and local http cannot satisfy it.
 *
 * Each consumer resolves the name ONCE from its ConfigService-derived
 * isProduction flag (never process.env directly; see repo/no-direct-process-env).
 */
const SESSION_COOKIE_BASE_NAME = 'session_id';

export function getSessionCookieName(isProduction: boolean): string {
  return isProduction ? `__Host-${SESSION_COOKIE_BASE_NAME}` : SESSION_COOKIE_BASE_NAME;
}

/**
 * Byte length of every raw secret minted for sessions and one-time tokens
 * (session tokens, email-verification and password-reset tokens): 32 bytes is
 * 256 bits of entropy, hex-encoded to 64 chars.
 */
export const TOKEN_ENTROPY_BYTES = 32;

/* -------------------------------------------------------------------------- */
/* Two-factor authentication (2FA)                                            */
/*                                                                            */
/* Every value below is a product knob of the 2FA feature. This file is their */
/* single home so the services, cron, and tests all read one source of truth. */
/* -------------------------------------------------------------------------- */

/**
 * TOTP algorithm parameters. SHA1/6/30s are the RFC 6238 defaults that Google
 * Authenticator assumes (it ignores the algorithm URI param), so anything else
 * silently breaks the most common authenticator. Window 1 accepts the
 * previous/current/next step (90 s clock-drift tolerance); throttling, not a
 * wide window, is the brute-force defense. Secret is 20 bytes / 160 bits
 * (upstream minimum is 16).
 */
export const TOTP_ALGORITHM = 'SHA1';
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_VALIDATION_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

/**
 * Replay guard: after a code validates, its counter slot is claimed in Redis
 * for 90 s (a bit over 2 periods + window) so the same code cannot be replayed
 * inside its validity window (shoulder-surf defense).
 */
export const TOTP_REPLAY_GUARD_TTL_SECONDS = 90;

/**
 * Pending login-challenge record ("half logged in" after password, before the
 * second factor). Lives 300 s, single-use, and allows at most 5 verify attempts
 * before it is destroyed and the user must restart from the password step.
 */
export const PENDING_CHALLENGE_TTL_SECONDS = 300;
export const MAX_VERIFY_ATTEMPTS_PER_PENDING = 5;

/**
 * A PENDING enrollment row (secret provisioned, not yet confirmed) is rejected
 * by `activate` once older than 1 hour; the hourly sweep is hygiene on top.
 */
export const PENDING_ENROLLMENT_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Recovery codes: 10 per user, 16 Crockford-base32 chars (80 bits) so unsalted
 * sha256 storage stays sound. The UI nags regeneration at <= 3 unused.
 */
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 16;
export const LOW_RECOVERY_CODES_THRESHOLD = 3;

/**
 * Trusted device ("remember this browser"): 30-day FIXED lifetime (no sliding
 * renewal, so the factor is re-proved monthly), capped at 5 per user
 * (oldest-first eviction, like max-sessions).
 */
export const TRUSTED_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const TRUSTED_DEVICE_CAP = 5;

/**
 * Authenticated 2FA management actions (activate/disable code checks) are
 * throttled per-user (not per-IP: a hijacked session could rotate addresses):
 * 5 attempts per 300 s. Challenge verify additionally rides the existing per-IP
 * auth envelope (10 / 60 s) via `enforceAuthRateLimit`.
 */
export const TWO_FACTOR_MANAGE_RATE_LIMIT = 5;
export const TWO_FACTOR_MANAGE_RATE_WINDOW_SECONDS = 300;

/**
 * Scope prefix for that budget. Beside the two numbers it governs, because the
 * budget is only shared if every caller spells the key the same way and the
 * literal used to appear at four call sites.
 */
export const TWO_FACTOR_MANAGE_RATE_SCOPE = '2fa-manage';

/**
 * Cookie names for the two 2FA cookies, mirroring `getSessionCookieName`: the
 * `__Host-` prefix in production binds each cookie to the exact host (Secure,
 * Path=/, no Domain), dev drops it because local http cannot satisfy Secure.
 * Both are set with httpOnly + `resolveSameSite(req)` so the raw token never
 * touches JS and the Electron app:// origin still receives them.
 *
 * `__Host-2fa`       carries the pending-challenge token (5 min).
 * `__Host-2fa-trust` carries the trusted-device token (30 d).
 */
export function getTwoFactorPendingCookieName(isProduction: boolean): string {
  return isProduction ? '__Host-2fa' : '2fa-pending';
}

export function getTrustedDeviceCookieName(isProduction: boolean): string {
  return isProduction ? '__Host-2fa-trust' : '2fa-trust';
}

/* -------------------------------------------------------------------------- */
/* Sudo (recent password re-confirmation)                                     */
/*                                                                            */
/* Sensitive account-surgery actions (email change) require the session to    */
/* have re-proved the password within the last 5 minutes. The flag lives in   */
/* Redis keyed by the SESSION (not the user), so confirming on one device     */
/* never elevates another.                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Lifetime of the sudo flag minted by `auth.confirmPassword`. 300 s matches
 * the pending-2FA window: long enough to complete the protected action,
 * short enough
 * that a walked-away session does not stay elevated.
 */
export const SUDO_TTL_SECONDS = 300;

/**
 * Redis key for the sudo flag. Deliberately NOT routed through `RedisKeys`:
 * that helper is the
 * tenant-prefix retrofit surface for request-scoped tenant DATA, while this is
 * a session-lifetime marker keyed by the already-tenantless sessionId, exactly
 * like `session:<id>` itself. The 2FA step-up (2FA T03) extends this same key.
 */
export function sudoKey(sessionId: string): string {
  return `sudo:${sessionId}`;
}
