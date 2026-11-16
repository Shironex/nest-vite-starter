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
- `<queue>.processor.ts`: `extends TracedWorkerHost`, decorated
  `@Processor(QUEUE_NAMES.X, { concurrency })`, `processJob` switches on
  `job.name`.
- `<queue>.module.ts`: `registerQueueWithDefaults(QUEUE_NAME, X_DEFAULTS)` from
  `common/queue` (registered exactly once), provides the processor,
  `exports: [BullModule]`. Calling `BullModule.registerQueue(` directly outside
  `common/queue` is a `lint:meta` failure
  (`queue-registration-through-helper`): it is the one call that can silently
  drop `defaultJobOptions`.

Three lint rules enforce the load-bearing parts: `repo/processor-must-extend-traced-worker-host`,
`repo/job-name-must-be-constant`, `repo/queue-add-must-wrap-job-context`.

## Idempotency contract (the important part)

BullMQ workers are **at-least-once**: a job can run more than once (retry after a
transient failure, or a worker crash mid-process). Design for re-execution.

- **The CALLER owns dedup**, not the worker. To collapse duplicate enqueues of
  the same logical action, pass a stable `jobId`:
  `queue.add(name, withJobContext(data), { jobId })`. Example: one verification
  email per token issuance keys on the token id. Do NOT try to make the worker
  itself dedup: the dedup key is domain-specific and lives at the call site.
- **Cron sweeps are idempotent by predicate.** A filtered `deleteMany` /
  conditional `update` on a stable predicate (e.g. `expiresAt < now`) races
  safely; a missed or doubled tick is harmless. `@Cron` fires on EVERY replica,
  so this is mandatory for any sweep (see token-cleanup.service.ts).
- **Reach for an `Idempotency-Key` table only for money or external-retry
  sources** (a payment, a webhook a third party may resend). The repo already
  has `common/idempotency/` for HTTP-level replay; use it at the boundary, not
  inside every worker.

## `@Cron` vs BullMQ repeatable: the fork in the road

- **Default to `@nestjs/schedule` `@Cron`** for periodic maintenance: a decorator
  on a provider, no queue/worker/scheduler-id to wire. Phase 3 owns the single
  `ScheduleModule.forRoot()`. The cost: `@Cron` runs on ALL replicas, so the job
  MUST be idempotent by predicate.
- **Use a BullMQ job scheduler** (`queue.upsertJobScheduler` with a fixed id,
  single dispatch) only when a job must run **exactly once across the fleet**
  (e.g. a billing run) and cannot be made safely idempotent. That is the
  exception, not the default. Wrap the template data in `withJobContext(...)` by
  hand (the `queue-add-must-wrap-job-context` rule only sees `.add`), and call
  `removeStaleJobSchedulers` after the upsert so a scheduler left under an old id
  cannot double the job. The legacy `queue.add(name, data, { repeat })` form was
  removed in BullMQ 6. `TwoFactorEnforcementScheduler` is the worked example.

## Failure handling / DLQ

`removeOnFail: false` is intentional: exhausted jobs are retained in the failed
set as the DLQ for inspection. The `queue_jobs_failed{queue}` gauge
(`QueueMetricsService`) makes the failed set observable; the queue health
indicator (observability-only, on `GET /health`, never depooling) reports `down`
above a threshold. A failed-job replay endpoint / admin UI is deferred to a
later admin phase.

## Observability

Producers wrap payloads in `withJobContext(...)` so the worker re-enters the
request's ALS context and trace (`TracedWorkerHost`). Never spread `job.data`
into downstream calls: destructure the fields you need, so the reserved
`_ctx` / `_traceparent` keys never leak.
