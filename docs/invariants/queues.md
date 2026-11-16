---
subsystem: Background queues
globs:
  - apps/api/src/common/queue/*.ts
  - apps/api/src/modules/**/*.processor.ts
  - apps/api/src/modules/**/*.constants.ts
  - apps/api/src/modules/**/*.module.ts
---

# Background queues

BullMQ workers are **at-least-once**. A job can run twice (a retry after a transient failure, a
worker crash mid-process), and `@Cron` fires on every replica. Everything here follows from that:
the queue conventions are mostly about making re-execution safe and making the retry policy
impossible to forget.

`apps/api/src/common/queue/CONVENTIONS.md` is the long form. This manifest is the checkable part.

## Entry points

- `common/queue/register-queue.ts` - `registerQueueWithDefaults`, the only sanctioned registration.
- `common/queue/traced-worker.host.ts` - the processor base class.
- `common/queue/job-context.ts` - `withJobContext`, which carries request context into the worker.
- Every `*.processor.ts` and its `*.constants.ts` under `apps/api/src/modules`.

## Risks

- `BullModule.registerQueue(` silently drops `defaultJobOptions`, so a queue registered that way
  has no retry, no backoff and unbounded completed/failed windows.
- A worker that assumes exactly-once corrupts on the retry that will eventually happen.
- A job name written as a literal drifts from the processor's `switch`, and the mismatch is a job
  that is enqueued and never handled.
- A worker that does not carry job context logs without a correlation id, so a failing job cannot
  be traced back to the request that queued it.

## Invariants

### A queue is registered through the helper, exactly once

**Enforced by:** `lint-meta:queue-registration-through-helper`, `file:apps/api/src/common/queue/register-queue.ts`

### A processor extends `TracedWorkerHost`

**Enforced by:** `eslint:repo/processor-must-extend-traced-worker-host`

### Every `queue.add` wraps its data in job context

**Enforced by:** `eslint:repo/queue-add-must-wrap-job-context`

### A job name comes from a constant, never a literal

**Enforced by:** `eslint:repo/job-name-must-be-constant`

### A queue's retry, backoff and retention policy is declared once and completely

**Enforced by:** `file:apps/api/src/common/queue/queue.constants.ts`, `file:apps/api/src/common/queue/CONVENTIONS.md`

`IQueueDefaults` requires `attempts`, bounded `removeOnComplete` and `removeOnFail`, a `backoff`
whenever `attempts > 1`, and a non-zero `concurrency`. A defaults object missing any of them fails
`check-types`, which is the cheapest enforcement in this file.

### Dedup lives at the call site, not in the worker

**Enforced by:** `unenforced`, follow-up in `docs/invariants/README.md#unenforced-invariants`

The dedup key is domain-specific (`jobId` keyed on a token id, for instance), so no rule can
require it. A worker that tries to dedup for itself is the anti-pattern to look for.

## Review checklist

- [ ] Is the queue registered with `registerQueueWithDefaults`, and only once?
- [ ] Is the job safe to run twice? If not, what `jobId` collapses the duplicates?
- [ ] Does a cron sweep use a stable predicate, so a doubled tick on two replicas is harmless?
- [ ] Are the job names constants shared by the producer and the processor `switch`?
