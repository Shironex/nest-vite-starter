import type { IQueueDefaults } from '../../../common/queue/queue.constants';
import { QUEUE_NAMES } from '../../../common/queue/queue.constants';

/** Canonical queue name, referenced through the central registry (never inline). */
export const TWO_FACTOR_ENFORCEMENT_QUEUE_NAME = QUEUE_NAMES.TWO_FACTOR_ENFORCEMENT;

/**
 * The single job this queue carries: the daily enforcement sweep. It is driven
 * by a BullMQ JOB SCHEDULER (not an `@Cron`) so the deadline-revocation and the
 * T-24h reminder fan-out run EXACTLY ONCE across the replica fleet (unlike an
 * `@Cron` which fires on every replica) while still being idempotent by
 * predicate so a doubled run is harmless. See common/queue/CONVENTIONS.md
 * ("@Cron vs BullMQ repeatable").
 */
export const TWO_FACTOR_ENFORCEMENT_JOB_NAMES = {
  SWEEP: 'sweep',
} as const;

export type TwoFactorEnforcementJobName =
  (typeof TWO_FACTOR_ENFORCEMENT_JOB_NAMES)[keyof typeof TWO_FACTOR_ENFORCEMENT_JOB_NAMES];

/**
 * Cron pattern for the scheduled sweep: daily at 03:00. Off-peak, and clear of
 * the `@Cron` maintenance slots (token-cleanup hourly, audit 04:00, notification
 * 05:00, user-purge 06:00).
 */
export const TWO_FACTOR_ENFORCEMENT_CRON = '0 3 * * *';

/**
 * Stable id of the job scheduler. `upsertJobScheduler` keys the schedule on it,
 * so registering the same spec on every boot updates rather than duplicates, and
 * the entry is easy to find in a queue UI.
 */
export const TWO_FACTOR_ENFORCEMENT_SCHEDULER_ID = 'two-factor-enforcement-daily';

/**
 * Reminder window: members of a tenant whose grace ends within the next 24h get
 * one T-24h nudge email per sweep. Keyed identically to the daily cadence so the
 * window and the tick line up (a member is reminded on the sweep before their
 * deadline).
 */
export const TWO_FACTOR_ENFORCEMENT_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Retry/retention policy for the queue, applied once at registration. `attempts:
 * 1` because the sweep is best-effort and idempotent-by-predicate: a transient
 * failure is swept up by the NEXT daily tick, not an in-tick retry that would
 * re-scan the same tenants. `concurrency: 1` keeps the singleton sweep from
 * overlapping itself. Completed instances are trimmed; failures are retained in
 * a bounded 7-day DLQ for inspection, same shape as the other queues.
 */
export const TWO_FACTOR_ENFORCEMENT_DEFAULTS: IQueueDefaults = {
  jobOptions: {
    attempts: 1,
    removeOnComplete: { age: 86_400, count: 50 },
    removeOnFail: { age: 604_800 },
  },
  concurrency: 1,
};
