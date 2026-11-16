/**
 * Example BullMQ processor: minimal copy-paste reference for new processors.
 *
 * NOT registered in any module on purpose. The shipped, real reference for the
 * full per-queue convention (constants + typed job data + producer + retry
 * policy + module wiring) is `modules/mail/email-delivery/`; read that and
 * `./CONVENTIONS.md` first. This file just shows the bare processor shape:
 *
 *   1. Decorate the class with `@Processor(QUEUE_NAMES.X)`, a constant from
 *      `./queue.constants`, never an inline string literal.
 *   2. Extend `QueueProcessor` (NOT the bare `WorkerHost`).
 *   3. Implement `processJob(job)`, NOT `process(job)`. The base class wraps
 *      `process` with a job-scoped request context, failure logging and the
 *      final-attempt Sentry report.
 *   4. Inject the queue in your producing service via:
 *
 *      ```ts
 *      @InjectQueue(QUEUE_NAMES.X) private readonly queue: Queue
 *      ```
 *
 *   5. Parse `job.data` with `parseJobData(schema, job)` before touching it.
 *      NOT OPTIONAL, and it is why this example carries a schema at all: the
 *      payload round-trips through Redis as JSON, so the compile-time type on
 *      `Job<T>` proves nothing about what actually comes back from an older
 *      producer, a manual replay or a corrupted entry. `parseJobData` throws
 *      `UnrecoverableError`, which sends an invalid payload straight to the
 *      failed set instead of burning the retry budget on a job that can never
 *      succeed. Every real processor does this; see `job-payload.ts`.
 *   6. Provide the processor from a worker module that the api imports through
 *      `inlineQueueWorker(...)` and `src/worker.module.ts` imports directly, so
 *      `QUEUE_WORKER` decides which process consumes the queue.
 *
 * Why a base class instead of an interceptor or decorator: BullMQ jobs run
 * outside any Nest request lifecycle, so an interceptor cannot fire. A
 * decorator would still need a base implementation to wrap `process(...)`. The
 * base class is the simplest discoverable shape.
 */
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { parseJobData } from './job-payload';
import { QueueProcessor } from './queue-processor';

const exampleJobSchema = z.object({
  userId: z.string().min(1).optional(),
  message: z.string().optional(),
});

// Disabled by default. Comment-in `@Processor('example')` and register the
// queue in a module to activate.
// @Processor('example')
export class ExampleProcessor extends QueueProcessor {
  // Uses the `logger` inherited from QueueProcessor (named after this class).

  async processJob(job: Job): Promise<void> {
    // Step 5: validate before reading anything. `data` is the STRIPPED payload,
    // so a key the schema does not name cannot leak into the logic below.
    const data = parseJobData(exampleJobSchema, job);

    // The job-scoped requestId is in the ALS store; the structured logger
    // picks it up automatically.
    this.logger.log(`Processing example job ${job.id} for user ${data.userId ?? 'anon'}`);
  }
}

// Decorator pinned outside the class to keep the line above lint-clean while
// the export is unused. When activating, remove this re-statement and apply
// `@Processor('example')` directly to the class.
void Processor;
