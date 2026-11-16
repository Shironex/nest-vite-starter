import type { BackoffOptions, JobsOptions } from 'bullmq';

/**
 * Canonical queue-name registry. Every queue name is referenced through this
 * object, never as an inline string literal, so a typo cannot silently create
 * a second queue and the `repo/job-name-must-be-constant` lint rule has a
 * source of truth to point producers and `@Processor(...)` decorators at.
 */
export const QUEUE_NAMES = {
  EMAIL_DELIVERY: 'email-delivery',
  NOTIFICATION_DISPATCH: 'notification-dispatch',
  TWO_FACTOR_ENFORCEMENT: 'two-factor-enforcement',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * A retention window that BullMQ can actually evict against. `age` is required:
 * every field of BullMQ's `KeepJobs` is optional on its own, so an unbounded
 * completed or failed set type-checks today, and a failed payload here can carry
 * PII (recipient addresses) on top of growing Redis without limit.
 */
export interface IBoundedRetention {
  readonly age: number;
  readonly count?: number;
}

/**
 * Attempts and backoff move together. One attempt needs no backoff; more than
 * one without a backoff retries immediately against a dependency that is
 * already failing, which is the retry storm the convention exists to prevent.
 * Ten is the ceiling because past that the job outlives any incident window it
 * could be waiting out.
 */
type RetryPolicy =
  | { readonly attempts: 1 }
  | {
      readonly attempts: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
      readonly backoff: BackoffOptions;
    };

/**
 * `JobsOptions` with the four fields a queue must not leave to BullMQ's
 * defaults made required and narrowed. Everything else (priority, delay, job
 * id) stays optional and unchanged.
 */
export type QueueJobDefaults = Omit<
  JobsOptions,
  'attempts' | 'backoff' | 'removeOnComplete' | 'removeOnFail'
> &
  RetryPolicy & {
    readonly removeOnComplete: IBoundedRetention;
    readonly removeOnFail: IBoundedRetention;
  };

/**
 * Worker concurrency, as a ladder rather than `number`. The point is that `0`
 * (a worker that never picks anything up) and a negative value cannot be
 * written at all; the gaps keep the choice a deliberate step between "singleton
 * sweep", "a few in flight" and "saturate the transport" instead of a number
 * somebody typed.
 */
export type QueueConcurrency = 1 | 2 | 3 | 4 | 5 | 8 | 10;

/**
 * Shape every per-queue constants file exports as its `*_DEFAULTS`. These are
 * applied once at the producer (`registerQueueWithDefaults(name, defaults)`) so
 * no call site re-specifies retry policy. `concurrency` is carried alongside the
 * job options for the `@Processor(name, { concurrency })` decorator even though
 * BullMQ keeps it separate from `JobsOptions`.
 */
export interface IQueueDefaults {
  readonly jobOptions: QueueJobDefaults;
  readonly concurrency: QueueConcurrency;
}

/** How often `QueueMetricsService` scrapes job counts into the gauges. */
export const QUEUE_METRICS_INTERVAL_MS = 15_000;

/**
 * Failed-depth at or above which the queue health indicator reports `down`.
 * This indicator is observability-only (wired into `GET /health`, NOT the
 * depooling `GET /health/ready`): a backlog of non-critical mail must never
 * pull the API node out of the load balancer.
 */
export const QUEUE_FAILED_ALERT_THRESHOLD = 100;
