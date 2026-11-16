---
title: Background Jobs and Crons
description: Every scheduled sweep and BullMQ queue in the API, their schedules, retry policy, and the shared idempotency and tracing contract they all follow.
sidebar:
  order: 6
---

## Two kinds of background work

This codebase deliberately uses two different mechanisms for two different problems:

- **`@Cron` (via `@nestjs/schedule`)** for maintenance sweeps that are safe to run redundantly. `@Cron` fires on **every replica** of the API - there is no leader election. Every cron in this repo is written to be idempotent by predicate so that redundant firing is harmless.
- **BullMQ queues** for work that must happen exactly once per triggering event (send this specific email, dispatch this specific notification) and that benefits from retry-with-backoff.

`ScheduleModule.forRoot()` is registered once, in `apps/api/src/app.module.ts` (comment: "Phase 3 owns ScheduleModule.forRoot() + the @Cron convention"). Do not register it again in a feature module.

## The shared cron contract

Every cron in this codebase follows the same contract, documented once (in `token-cleanup.service.ts`) and referenced by the others, and also written centrally in `apps/api/src/common/queue/CONVENTIONS.md`:

1. **Idempotent by predicate** - the sweep's `WHERE` clause (`expiresAt < now`, `deletedAt < cutoff`, `createdAt < cutoff`) makes re-running it redundant, not harmful. This is what makes firing on every replica safe.
2. **Best-effort, never throws** - `sweep()` (the method the `@Cron` handler delegates to) wraps its body in try/catch and returns `0` on any failure rather than crashing the scheduler or the process.
3. **Metric-emitting** - every sweep increments a Prometheus counter so its work (or lack of it) is observable, even though it never throws.

Tests call `sweep()` directly rather than waiting for the cron to fire, since `@Cron` only schedules once `ScheduleModule` bootstraps and never fires on a test clock.

## The four crons

| Cron                     | File                                                                   | Schedule           | Purpose                                                                                    |
| ------------------------ | ---------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `token-cleanup`          | `apps/api/src/modules/auth/services/token-cleanup.service.ts`          | `EVERY_HOUR`       | Delete expired `Token` rows (email verification + password reset)                          |
| `user-purge`             | `apps/api/src/modules/user/user-purge.service.ts`                      | `EVERY_DAY_AT_6AM` | Hard-delete soft-deleted `User` rows past their grace window, plus their S3 avatar objects |
| `audit-log-retention`    | `apps/api/src/modules/audit/audit-retention.service.ts`                | `EVERY_DAY_AT_4AM` | Delete `AuditLog` rows past the retention window                                           |
| `notification-retention` | `apps/api/src/modules/notifications/notification-retention.service.ts` | `EVERY_DAY_AT_5AM` | Delete `Notification` rows past the retention window                                       |

The 4/5/6 AM stagger is deliberate - a code comment in `user-purge.service.ts` notes: "6AM: the 4AM and 5AM slots are taken by the audit and notification sweeps," so the three daily batched deletes never contend for the same maintenance window.

### token-cleanup

```ts
@Cron(CronExpression.EVERY_HOUR, { name: 'token-cleanup' })
async handleCron(): Promise<void> { await this.sweep(); }
```

Deletes rows from `deleteExpired(now())` on `TokenRepository`. Emits `tokenCleanupDeletedTotal`. No configurable window - it always deletes anything already past its own `expiresAt`.

### user-purge

```ts
@Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'user-purge' })
```

Capped at `USER_PURGE_MAX_PER_SWEEP = 500` rows per tick, oldest-`deletedAt`-first. Per row: delete the S3 avatar prefix (`avatars/<id>/`) **before** the DB row (so a mid-sweep crash can't orphan S3 objects with no owning row), then a guarded `deleteMany` on the row id. Grace window is `USER_PURGE_GRACE_DAYS` (default 30 days). Full detail in [users-and-account-lifecycle.md](/backend/users-and-account-lifecycle/#the-purge-cron), including exactly what does and doesn't cascade.

### audit-log-retention

```ts
@Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'audit-log-retention' })
```

Batched: `AUDIT_RETENTION_BATCH_SIZE = 5000` per pass, capped at `AUDIT_RETENTION_MAX_BATCHES = 200` per tick (roughly a 1M-row/day ceiling - a larger backlog drains across consecutive days). Retention window `AUDIT_LOG_RETENTION_DAYS` (default 365, floor of 30 enforced by Joi so a fat-fingered value can't gut the compliance trail). Full detail in [audit-logging.md](/backend/audit-logging/#retention).

This sweep is also the **only** thing that erases the client IP and user-agent stored on audit rows: the table has no update path, and user deletion nulls `userId` alone. Moving `AUDIT_LOG_RETENTION_DAYS` moves that horizon too - see [the processed-data inventory](/backend/audit-logging/#processed-personal-data).

### notification-retention

```ts
@Cron(CronExpression.EVERY_DAY_AT_5AM, { name: 'notification-retention' })
```

Same batching shape as audit retention. Retention window `NOTIFICATION_RETENTION_DAYS` (default 90, floor of 7). Deletes regardless of read state. Full detail in [notifications.md](/backend/notifications/#retention).

### A fifth scheduled job (not a cron)

`QueueMetricsService.collect()` (`apps/api/src/common/queue/queue-metrics.service.ts`) uses `@Interval(15_000)` (`QUEUE_METRICS_INTERVAL_MS`) to scrape BullMQ job counts (`waiting`, `active`, `failed`, `delayed`) into Prometheus gauges and an in-memory cache, for both queues. It's the data source the [queue health indicator](#queue-health) and the Prometheus alert rules read from.

## The two BullMQ queues

`QUEUE_NAMES` (`apps/api/src/common/queue/queue.constants.ts`) is the single source of truth for queue names - never an inline string literal, enforced by the `job-name-must-be-constant` lint rule (below):

```ts
export const QUEUE_NAMES = {
  EMAIL_DELIVERY: 'email-delivery',
  NOTIFICATION_DISPATCH: 'notification-dispatch',
} as const;
```

| Queue                   | Processor                       | Job names                                                                           | Attempts | Backoff         | DLQ retention               | Concurrency |
| ----------------------- | ------------------------------- | ----------------------------------------------------------------------------------- | -------- | --------------- | --------------------------- | ----------- |
| `email-delivery`        | `EmailDeliveryProcessor`        | `send-verification`, `send-password-reset`, `send-welcome`, `send-password-changed` | 5        | exponential, 5s | 7 days (`removeOnFail.age`) | 5           |
| `notification-dispatch` | `NotificationDispatchProcessor` | `dispatch`                                                                          | 3        | exponential, 5s | 7 days                      | 5           |

Full detail on each in [mail.md](/backend/mail/) and [notifications.md](/backend/notifications/). This page covers the shared infrastructure both ride on.

> **Doc/code drift worth knowing about**: `apps/api/src/common/queue/CONVENTIONS.md` states `removeOnFail: false is intentional` (failed jobs retained forever). The actual constants files for both real queues set `removeOnFail: { age: 604_800 }` (a 7-day cap, justified inline by PII-at-rest concerns). Trust the code over that line in CONVENTIONS.md if the two ever disagree again.

## Shared queue infrastructure

`apps/api/src/common/queue/`:

- **`queue.module.ts`** - `@Global()` module registering `BullModule.forRootAsync` with a **dedicated** ioredis connection (`createBullRedisConnection(redisUrl)`), separate from the app's general-purpose `REDIS_CLIENT`. It passes the full `REDIS_URL` string (not a `{host, port}` factory) to preserve auth/TLS/db-index, and sets `maxRetriesPerRequest: null`, which BullMQ requires for its blocking `BRPOPLPUSH`-style reads (the general Redis client elsewhere uses `maxRetriesPerRequest: 3`, so these must be two separate connections).
- **`job-context.ts`** - `withJobContext(data)` stamps the current AsyncLocalStorage `IRequestContext` (requestId, userId, traceId, spanId, **tenantId, workspaceId**) plus a W3C `traceparent` onto the job payload before `queue.add(...)`. `rebuildRequestContextFromJob(envelope, jobId)` does the inverse on the worker side, falling back to a deterministic `job-${jobId}` request id if the producer never called `withJobContext` - so worker logs are never identifier-less. Tenant context genuinely does propagate across the queue boundary today (this is already wired, not aspirational); see [tenancy.md](/backend/tenancy/#queued-work-carries-tenant-context-too).
- **`job-payload.ts`** - `parseJobData(schema, job)` re-validates `job.data` against its zod schema at the top of every processor case, because a job payload round-trips through Redis as JSON and a compile-time type proves nothing about what's actually in it (old producer versions, manual replays, corruption). On mismatch it throws `UnrecoverableError` with a message containing only zod issue paths/codes, never payload values (job data can carry recipient emails) - this fails the job straight to the DLQ, since a malformed payload can never succeed by retrying.
- **`traced-worker.host.ts`** - `TracedWorkerHost`, the abstract base every processor must extend instead of `@nestjs/bullmq`'s bare `WorkerHost`. Subclasses implement `processJob(job, token?)` instead of `process(job)`. The base class:
  1. Pulls `_ctx`/`_traceparent`/`_tracestate` off `job.data`.
  2. Re-enters `requestContext.run(store, ...)` so structured logs inside the worker carry the producer's `requestId`/`userId`/tenant.
  3. Extracts the traceparent into OTel and opens a `bullmq.process <queueName>` span as a child of the producer's span, so a trace viewer shows a continuous chain: HTTP request → `queue.add` → worker process → whatever the worker does.
  4. On failure, calls `Sentry.captureException` **only if `isFinalJobAttempt(job, err)`** is true - the last attempt, or an `UnrecoverableError` - so a transient failure a retry will absorb never pages anyone. Always logs `BullMQ job failed: ...` regardless (so retries are still visible in logs even when they don't alert).

```ts
export function isFinalJobAttempt(job: Job, err: unknown): boolean {
  const maxAttempts = job.opts?.attempts ?? 1;
  return job.attemptsMade + 1 >= maxAttempts || err instanceof UnrecoverableError;
}
```

Both real processors (`EmailDeliveryProcessor`, `NotificationDispatchProcessor`) key their own failure-counter increments off this same helper, so a retry-in-progress is never double-counted against `mailSendFailuresTotal` or an equivalent.

### Job defaults cannot be omitted (`register-queue.ts`)

Every field of BullMQ's `JobsOptions` is optional, so a defaults object that forgets
`attempts` or `removeOnFail` type-checks, and a `registerQueue` call that passes no
`defaultJobOptions` at all type-checks too. The consequences are quiet: a missing
`removeOnComplete`/`removeOnFail` lets Redis grow without bound, a missing `attempts`
silently means one try, and `attempts > 1` with no `backoff` retries immediately against a
dependency that is already failing.

`IQueueDefaults` closes that off in the type system rather than with a lint rule:

- `removeOnComplete` and `removeOnFail` are required and bounded.
- `attempts` and `backoff` are one union: either exactly one attempt, or more than one
  **with** a backoff. Retrying immediately is not expressible.
- `concurrency` is a ladder that does not include `0`, so a queue that never processes
  anything cannot be configured by accident.

Registration goes through `registerQueueWithDefaults(name, DEFAULTS)`, which takes the whole
object as a required argument. The lint-meta rule `queue-registration-through-helper` makes
that helper the only door by banning a bare `BullModule.registerQueue(` outside
`apps/api/src/common/queue/`, where the helper itself lives.

Why types here and a lint rule elsewhere: the upstream `eslint-plugin-bullmq` rules track
options on a `new Queue(...)` in the same file. Under NestJS the options are registered in a
different module from where jobs are added, so those rules would flag every
`this.queue.add(...)` and miss the real thing.

## Lint rules enforcing the queue contract

`packages/eslint-plugin-repo/src/rules/`, docs under `packages/eslint-plugin-repo/docs/rules/`:

- **`processor-must-extend-traced-worker-host`** - any class decorated `@Processor(...)` must literally `extends TracedWorkerHost` (handles the generic `TracedWorkerHost<T>` form too). Report-only, not auto-fixable (changing a base class is a semantic edit). This is the DI-shaped replacement for the upstream `eslint-plugin-bullmq` rule `worker-must-listen-failed`, which only matches standalone `new Worker(...)` and misses Nest's decorator-based processors entirely.

  ```ts
  // Incorrect
  @Processor(QUEUE_NAMES.EMAIL_DELIVERY)
  export class EmailDeliveryProcessor extends WorkerHost {}
  // Correct
  @Processor(QUEUE_NAMES.EMAIL_DELIVERY)
  export class EmailDeliveryProcessor extends TracedWorkerHost {}
  ```

- **`queue-add-must-wrap-job-context`** - a `.add(name, data)` call on anything matching `/queue/i` must wrap `data` in `withJobContext(...)`. Heuristic (no type info), report-only.

  ```ts
  // Incorrect
  await this.queue.add(JOB_NAMES.SEND_WELCOME, { to });
  // Correct
  await this.queue.add(JOB_NAMES.SEND_WELCOME, withJobContext({ to }));
  ```

- **`job-name-must-be-constant`** - flags a string literal as the first argument to `@Processor('...')` or `<queue>.add('...', ...)`; both must reference a named constant (`QUEUE_NAMES.*`, `*_JOB_NAMES.*`) so a typo can't silently spin up a second queue and producer/consumer names can't drift apart.

## Queue health

`apps/api/src/modules/health/indicators/queue.health.ts`: observability-only, reads the **cached** counts from `QueueMetricsService` (no live Redis probe per health check, to avoid `/health` flapping on a transient Redis blip). Reports `down` when any queue's `failed` count reaches `QUEUE_FAILED_ALERT_THRESHOLD = 100`. Deliberately wired into `GET /health` only, **never** `GET /health/ready` - a backlog of non-critical mail must never depool the API node from the load balancer.

## Modifying this area

- **Adding a new cron**: follow the exact contract above - predicate-based idempotency, never throw out of `sweep()`, emit a counter. Pick an unused early-morning hour slot if it's a daily batched delete, to avoid contending with the existing three.
- **Adding a new queue/processor**: register the queue name in `QUEUE_NAMES`, extend `TracedWorkerHost`, wrap every `.add()` call in `withJobContext(...)`, validate `job.data` with `parseJobData` at the top of every case, and set an explicit `removeOnFail.age` (don't rely on the default - see the CONVENTIONS.md drift note above).
- **Local queue inspection**: there is no `@bull-board` UI wired into this repo today; visibility is entirely through the Prometheus gauges (`queue_jobs_waiting/active/failed/delayed`, labeled by `queue`) and the `/health` endpoint.
- Running the queue/cron test suite: `pnpm --filter @repo/api test -- queue` or target a specific service, e.g. `pnpm --filter @repo/api test -- user-purge`.
