import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import * as Sentry from '@sentry/nestjs';
import { UnrecoverableError } from 'bullmq';
import type { Job, Worker } from 'bullmq';
import { requestContext, type IRequestContext } from '../context/request-context';

/**
 * Whether the failure that `err` caused is FINAL for this job: either the
 * attempt that is running right now is the last one BullMQ will make (its
 * attemptsMade counter increments after an attempt finishes, so the current
 * attempt is attemptsMade + 1, the same arithmetic as BullMQ's own
 * shouldRetryJob), or the error is a BullMQ `UnrecoverableError`, which fails
 * the job straight to the failed set (the DLQ) with no further retries.
 */
export function isFinalJobAttempt(job: Job, err: unknown): boolean {
  const maxAttempts = job.opts?.attempts ?? 1;
  return job.attemptsMade + 1 >= maxAttempts || err instanceof UnrecoverableError;
}

/**
 * The one base class every processor extends, in place of `@nestjs/bullmq`'s
 * bare `WorkerHost`. Subclasses implement `processJob(job)` instead of
 * `process(job)`. The base class:
 *
 *   1. Runs the job inside a request-context scope with a job-derived
 *      `requestId` (`job-<id>`), so every log line the job writes is greppable
 *      by job even though it runs outside any HTTP request.
 *   2. Logs a failed attempt with the queue, job name, id and attempt, because
 *      a worker runs outside the exception filter and would otherwise leave
 *      nothing in the logs.
 *   3. Reports the FINAL failure to Sentry (see `isFinalJobAttempt`), never a
 *      transient one a retry will absorb. A safe no-op when Sentry has no DSN.
 *
 * Subclasses MUST be decorated with `@Processor(QUEUE_NAMES.X)` from
 * `@nestjs/bullmq`.
 */
export abstract class QueueProcessor<T extends Worker = Worker> extends WorkerHost<T> {
  // Resolves to the concrete processor's name so failure logs are attributable.
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Override this in your processor instead of `process`. The return value is
   * forwarded to BullMQ, and a throw fails the attempt as usual.
   */
  abstract processJob(job: Job, token?: string): Promise<unknown>;

  async process(job: Job, token?: string): Promise<unknown> {
    const store: IRequestContext = { requestId: job.id ? `job-${job.id}` : 'job-no-id' };

    try {
      return await requestContext.run(store, () => this.processJob(job, token));
    } catch (err) {
      if (isFinalJobAttempt(job, err)) {
        Sentry.captureException(err, {
          extra: {
            queue: job.queueName,
            jobName: job.name,
            jobId: job.id ?? 'unknown',
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts?.attempts ?? 1,
          },
        });
      }
      this.logger.error(
        'BullMQ job failed',
        {
          queue: job.queueName,
          jobName: job.name,
          jobId: job.id ?? 'unknown',
          attempt: job.attemptsMade + 1,
        },
        err instanceof Error ? err : new Error(String(err)),
      );
      throw err;
    }
  }
}
