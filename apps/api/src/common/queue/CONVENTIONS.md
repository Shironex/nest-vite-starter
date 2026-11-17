# Queue conventions

How background work is shaped in this codebase. Read this before adding a queue
or a scheduled job. The runtime reference implementation is
`apps/api/src/modules/mail/email-delivery/`.

## Per-queue folder layout

One folder per queue, co-located with the module that produces onto it (mirrors
how `email-delivery/` sits under `modules/mail/`). Each folder holds:

- `<queue>.constants.ts`: the queue name (re-exported from `QUEUE_NAMES`, never
  an inline literal), the job names (`*_JOB_NAMES`), and a `*_DEFAULTS`
  (`IQueueDefaults`: `jobOptions` + `concurrency`) that pins retry/backoff/DLQ
  policy ONCE. `IQueueDefaults` REQUIRES `attempts`, bounded `removeOnComplete`
  and `removeOnFail` windows, a `backoff` whenever `attempts > 1`, and a
  non-zero `concurrency`; a defaults object that leaves any of them out fails
  `check-types`.
- `<queue>.types.ts`: the typed job-data contract (a union keyed by job name).
- `<queue>.processor.ts`: `extends QueueProcessor`, decorated
  `@Processor(QUEUE_NAMES.X, { concurrency })`, `processJob` switches on
  `job.name`.
- `<queue>.module.ts`: `registerQueueWithDefaults(QUEUE_NAME, X_DEFAULTS)` from
  `common/queue` (registered exactly once), `exports: [BullModule]`. The
  producer side only. Calling `BullModule.registerQueue(` directly outside
  `common/queue` is not allowed: it is the one call that can silently drop
  `defaultJobOptions`.
- `<queue>-worker.module.ts`: provides the processor (plus whatever it sends
  through) and imports `<queue>.module.ts`. Registering a `@Processor` is what
  starts a worker, so this module is imported in two places only: AppModule,
  through `inlineQueueWorker(...)`, and `src/worker.module.ts`.

## Where the workers run (`QUEUE_WORKER`)

- `inline` (the default): the api process consumes the queues. One container.
- `off`: the api only enqueues, and the standalone worker consumes:
  `pnpm --filter @repo/api start:worker` after a build (`node dist/src/worker`,
  so a second container can run the api image with that command).

Producers never change: the queue is registered in both modes.

## Idempotency contract (the important part)

BullMQ workers are **at-least-once**: a job can run more than once (retry after a
transient failure, or a worker crash mid-process). Design for re-execution.

- **The CALLER owns dedup**, not the worker. To collapse duplicate enqueues of
  the same logical action, pass a stable `jobId`:
  `queue.add(name, data, { jobId })`. Example: one verification
  email per token issuance keys on the token id. Do NOT try to make the worker
  itself dedup: the dedup key is domain-specific and lives at the call site.
- **Cron sweeps are idempotent by predicate.** A filtered `deleteMany` /
  conditional `update` on a stable predicate (e.g. `expiresAt < now`) races
  safely; a missed or doubled tick is harmless. `@Cron` fires on EVERY replica,
  so this is mandatory for any sweep (see token-cleanup.service.ts).
- **Reach for an `Idempotency-Key` table only for money or external-retry
  sources** (a payment, a webhook a third party may resend), and put it at the
  boundary, not inside every worker.

## `@Cron` vs BullMQ repeatable: the fork in the road

- **Default to `@nestjs/schedule` `@Cron`** for periodic maintenance: a decorator
  on a provider, no queue/worker/scheduler-id to wire. Phase 3 owns the single
  `ScheduleModule.forRoot()`. The cost: `@Cron` runs on ALL replicas, so the job
  MUST be idempotent by predicate.
- **Use a BullMQ job scheduler** (`queue.upsertJobScheduler` with a fixed id,
  single dispatch) only when a job must run **exactly once across the fleet**
  (e.g. a billing run) and cannot be made safely idempotent. That is the
  exception, not the default. Remove any scheduler left under an old id after
  the upsert so it cannot double the job. The legacy `queue.add(name, data, { repeat })` form was removed in
  BullMQ 6.

## Failure handling / DLQ

Exhausted jobs are retained in the failed set as the DLQ for inspection,
bounded by `removeOnFail`. `QueueMetricsService` caches each queue's job counts
so the failed set is observable without a Redis round-trip per probe; the queue health
indicator (observability-only, on `GET /health`, never depooling) reports `down`
above a threshold. A failed-job replay endpoint / admin UI is deferred to a
later admin phase.

## Observability

`QueueProcessor` runs each job under a `job-<id>` request id, so every log line
the job writes is greppable by job, logs every failed attempt, and reports the
final one to Sentry (a no-op without `SENTRY_DSN`). Never spread `job.data`
into downstream calls: parse it with `parseJobData` and use the parsed fields.
