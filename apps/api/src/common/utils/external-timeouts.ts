/**
 * Time budgets for the api's outbound calls. Nothing on a request path may wait
 * on a remote peer without one: a stalled peer otherwise holds the request (or a
 * worker slot) open for undici's 300 s headers timeout, the SDK's unbounded
 * default, or nodemailer's 2 min connect and 10 min socket-idle defaults.
 */

/** Cloudflare siteverify answers in well under a second; sign-in waits on it. */
export const TURNSTILE_VERIFY_TIMEOUT_MS = 5_000;

/** Time allowed to open the TCP/TLS connection to the S3 endpoint. */
export const S3_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * S3 socket INACTIVITY budget, not a total request cap: a streaming
 * PUT or GET of a large document keeps resetting it while bytes move, so only a
 * genuinely stalled transfer is cut. (`requestTimeout` is deliberately unused:
 * it is a total cap, and the SDK only warns on it without `throwOnRequestTimeout`.)
 */
export const S3_SOCKET_TIMEOUT_MS = 60_000;

/** SMTP: time to open the connection, to receive the server greeting, and to sit idle. */
export const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
export const SMTP_GREETING_TIMEOUT_MS = 10_000;
export const SMTP_SOCKET_TIMEOUT_MS = 30_000;
