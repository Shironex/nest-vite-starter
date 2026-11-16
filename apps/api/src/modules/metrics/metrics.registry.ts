import { Counter, Gauge, Histogram } from 'prom-client';

/**
 * Centralized Prometheus histogram registrations.
 *
 * Instantiated as module-level singletons so they are registered exactly once
 * against the global prom-client registry. Do NOT call new Histogram() inside
 * a NestJS provider: parallel Jest workers would trigger double-registration
 * errors because the registry is global per process. Each histogram is
 * exported so other modules (interceptor, tRPC middleware) can record
 * observations without going through DI.
 *
 * Label cardinality rules:
 *   - NO userId, requestId, raw path, raw status code, or UUIDs
 *   - route = matched Express route pattern (e.g. /api/auth/login)
 *   - status_class = 2xx | 3xx | 4xx | 5xx
 */

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds, labeled by method, route, and status class',
  labelNames: ['method', 'route', 'status_class'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const trpcProcedureDuration = new Histogram({
  name: 'trpc_procedure_duration_seconds',
  help: 'Duration of tRPC procedure calls in seconds, labeled by procedure, type, and ok',
  labelNames: ['procedure', 'type', 'ok'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const tokenCleanupDeletedTotal = new Counter({
  name: 'token_cleanup_deleted_total',
  help: 'Total expired auth tokens deleted by the scheduled token-cleanup sweep',
});

// AuditService.log swallows write failures by design (an audit outage must not
// break the business operation), which makes silent audit-trail loss invisible
// without a metric to alert on. No action label: action names are unbounded
// strings and the alert condition is "any audit write failed".
export const auditWriteFailuresTotal = new Counter({
  name: 'audit_write_failures_total',
  help: 'Total audit-log writes that failed and were swallowed (audit rows lost)',
});

export const auditRetentionDeletedTotal = new Counter({
  name: 'audit_retention_deleted_total',
  help: 'Total AuditLog rows deleted by the scheduled audit-log-retention sweep',
});

// Mail is fully queue-backed, so a lost email has exactly two shapes: the
// producer could not enqueue (Redis/queue outage; callers tolerate it by
// design) or the worker exhausted its retries (job now in the DLQ). Both are
// user-invisible without this counter. `template` is the BullMQ job name
// (send-verification, send-password-reset, ...), a small bounded set.
export const mailSendFailuresTotal = new Counter({
  name: 'mail_send_failures_total',
  help: 'Total emails lost: enqueue failures at the producer plus final-attempt (retries-exhausted) worker failures, labeled by template',
  labelNames: ['template'] as const,
});

// The old-avatar S3 cleanup after an avatar change is best-effort by design
// (a delete failure must not block the profile update), so each failure
// leaves an orphaned object behind. The warn log alone gives no trend line;
// this counter makes the leak rate visible.
export const storageOrphanCleanupFailuresTotal = new Counter({
  name: 'storage_orphan_cleanup_failures_total',
  help: 'Total best-effort old-avatar S3 cleanup deletions that failed (objects orphaned in storage)',
});

export const userPurgeDeletedTotal = new Counter({
  name: 'user_purge_deleted_total',
  help: 'Total soft-deleted user rows hard-deleted by the scheduled user-purge sweep after the grace window',
});

// The retention/cleanup crons catch their own failures and retry next tick,
// so a sweep that starts failing every day (schema drift, Prisma bump) has no
// alertable signal: the *_deleted_total counters above sit at 0 in the normal
// case too. One failure counter per sweep makes "cron is broken" a threshold
// alert instead of a log-grep. `sweep` is a small bounded set.
export const cronSweepFailuresTotal = new Counter({
  name: 'cron_sweep_failures_total',
  help: 'Total scheduled sweep runs that failed and were deferred to the next tick, labeled by sweep',
  labelNames: ['sweep'] as const,
});

// Each per-user purge failure (S3 prefix delete or row delete) leaves the row
// for the next sweep by design, so without a counter a persistently failing
// purge (e.g. S3 auth broken) would silently never erase anything.
export const userPurgeFailuresTotal = new Counter({
  name: 'user_purge_failures_total',
  help: 'Total per-user purge attempts that failed (S3 prefix delete or row delete) and were deferred to the next sweep',
});

// The hourly stale-PENDING sweep deletes abandoned TOTP enrollment rows whose
// 1-hour activation window elapsed. The activate() path is the correctness
// backstop; this counter makes the hygiene sweep observable (0 in the normal
// case, so failures alert via `cron_sweep_failures_total{sweep="two-factor-
// pending-cleanup"}`).
export const twoFactorPendingCleanupDeletedTotal = new Counter({
  name: 'two_factor_pending_cleanup_deleted_total',
  help: 'Total stale PENDING SecondFactor rows deleted by the scheduled two-factor-pending-cleanup sweep',
});

// TotpService.verify fails CLOSED when the stored secret cannot be decrypted
// (tampered ciphertext, or far more commonly an ENCRYPTION_KEY rotation): it
// returns false, which the caller surfaces as an ordinary "Invalid code". A
// rotation therefore turns EVERY submission into a wrong-code result that feeds
// lockouts, with no operator signal to tell it apart from users mistyping their
// codes. This counter isolates the decrypt-failure path so a rotation reads as
// a spike instead of a support-ticket mystery. Ordinary wrong-but-decryptable
// codes are NOT counted.
export const totpDecryptFailuresTotal = new Counter({
  name: 'totp_decrypt_failures_total',
  help: 'Total TOTP verifications that failed closed because the stored secret could not be decrypted (e.g. after an ENCRYPTION_KEY rotation), distinct from ordinary wrong codes',
});

// The nine @Cron sweeps above all carry a failure counter, which answers "did a
// tick break" but not "did a tick happen". Nothing else does either: every one
// of them is a delete/reconcile pass whose *_deleted_total sits at 0 on a quiet
// day, so a scheduler that never fires (ScheduleModule not bootstrapped, a
// container that starts and is never given the cron role, a @Cron name collision)
// produces exactly the same flat series a healthy weekend does. This gauge is
// the liveness half: set to the wall-clock seconds at the END of every
// successful tick, so ONE alert covers all nine.
//
//   time() - max by (sweep) (cron_sweep_last_success_timestamp_seconds) > 36h
//
// MAX, not the raw series. @Cron fires on every replica, and a sweep that
// claims a per-day tick lock deliberately lets the losing replicas do
// nothing, so their gauge legitimately stays stale. The fleet is
// alive if ANY replica finished a tick, which is what max expresses. 36h is
// chosen against the slowest cadence here (daily) with a full missed run of
// slack; the hourly sweeps are covered by the same threshold far more loosely,
// which is the price of one rule instead of nine.
export const cronSweepLastSuccessTimestampSeconds = new Gauge({
  name: 'cron_sweep_last_success_timestamp_seconds',
  help: 'Unix timestamp (seconds) at which each scheduled sweep last completed a tick without throwing, labeled by sweep. Alert on time() - max by (sweep) (...) to detect a sweep that stopped running rather than one that started failing',
  labelNames: ['sweep'] as const,
});

// Authentication outcomes were AuditLog rows and nothing else: zero logger
// calls in login.service.ts and no auth counter at all. A credential-stuffing
// run therefore showed up only as
// `trpc_procedure_duration_seconds{procedure="auth.login",ok="false"}`, which
// also counts 500s, and lockout rate, 2FA failure rate, reset completions and
// session-epoch fence refusals were queryable only by SQL over the audit table,
// which AuditService.log swallows on failure.
//
// `flow` and `outcome` are both closed sets written at the call site (see
// auth-outcome.recorder.ts), never derived from user input, so cardinality is
// bounded. NO userId here: that is what the log line and the audit row are for.
export const authOutcomesTotal = new Counter({
  name: 'auth_outcomes_total',
  help: 'Total authentication outcomes, labeled by flow (login, twofa_challenge, oauth_callback, password_reset, session_mint) and outcome',
  labelNames: ['flow', 'outcome'] as const,
});
