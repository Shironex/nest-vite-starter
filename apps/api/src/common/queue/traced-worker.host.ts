import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import { context, propagation, trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/nestjs';
import { UnrecoverableError } from 'bullmq';
import type { Job, Worker } from 'bullmq';
import { requestContext } from '../context/request-context';
import { rebuildRequestContextFromJob, type TracePropagationCarrier } from './job-context';
import { queueJobDurationSeconds, queueJobFailuresTotal } from './queue.metrics';

/**
 * Whether the failure that `err` caused is FINAL for this job: either the
 * attempt that is running right now is the last one BullMQ will make (its
 * attemptsMade counter increments after an attempt finishes, so the current
 * attempt is attemptsMade + 1, the same arithmetic as BullMQ's own
 * shouldRetryJob), or the error is a BullMQ `UnrecoverableError`, which fails
 * the job straight to the failed set (the DLQ) with no further retries.
 * Shared by the Sentry gate below and by processors that keep per-queue
 * failure counters (e.g. mail_send_failures_total), so "final" always means
 * the same thing and nothing double-fires on retried attempts.
 */
export function isFinalJobAttempt(job: Job, err: unknown): boolean {
  const maxAttempts = job.opts?.attempts ?? 1;
  return job.attemptsMade + 1 >= maxAttempts || err instanceof UnrecoverableError;
}

/**
 * Drop-in replacement for `@nestjs/bullmq`'s `WorkerHost`. Subclasses
 * override `processJob(job)` instead of `process(job)`. The base class:
 *
 *   1. Pulls `_ctx` (requestId/userId/traceId/spanId) and `_traceparent` /
 *      `_tracestate` off `job.data` if the producer used `withJobContext`.
 *   2. Re-enters `requestContext.run(...)` so structured logs in the worker
 *      automatically carry the producer's `requestId`/`userId`.
 *   3. Re-extracts the W3C traceparent into the OTel active context and
 *      starts a `bullmq.process` span as a child of the producer's span.
 *      Spans created by user code inside `processJob` will then be children
 *      of THIS span, giving Tempo a continuous parent->child chain
 *      (HTTP request -> queue.add -> worker process -> ...).
 *   4. Records `queue_job_duration_seconds` and, on a throw,
 *      `queue_job_failures_total`. Both belong HERE rather than in any
 *      processor: this method already wraps every one of them and already
 *      decides what "final" means, so instrumenting it is the only way to get
 *      the same answer from all four queues without four correct copies of it.
 *
 * Pattern rationale: a base class is the lowest-friction shape for a
 * template: every processor extends one type and gets propagation for
 * free, no decorator to remember. Decorator-style would require Reflect
 * metadata gymnastics and surface only inside an interceptor; for a small
 * queue surface the base class is more discoverable.
 *
 * Subclasses MUST be decorated with `@Processor('queue-name')` from
 * `@nestjs/bullmq` and implement `processJob(job)`.
 */
export abstract class TracedWorkerHost<T extends Worker = Worker> extends WorkerHost<T> {
  // Resolves to the concrete processor's name so failure logs are attributable.
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Override this in your processor instead of `process`. Behaves
   * identically: return value is forwarded to BullMQ; throws cause job
   * failure as usual. Receives the original Job; `job.data` may include
   * `_ctx` / `_traceparent` / `_tracestate` if the producer stamped them.
   */
  abstract processJob(job: Job, token?: string): Promise<unknown>;

  async process(job: Job, token?: string): Promise<unknown> {
    // `job.data` is JSON out of Redis, so the three reserved keys are read as
    // unknown and checked, not asserted. `rebuildRequestContextFromJob` parses
    // `_ctx` itself (that one becomes the tenant scope, so it gets a schema);
    // the two trace headers only need to be strings before they reach the OTel
    // propagator, which would otherwise be handed an object.
    const data = (job.data ?? {}) as Record<string, unknown>;
    const envelope: unknown = data['_ctx'];

    const carrier: TracePropagationCarrier = {};
    if (typeof data['_traceparent'] === 'string') carrier['traceparent'] = data['_traceparent'];
    if (typeof data['_tracestate'] === 'string') carrier['tracestate'] = data['_tracestate'];

    // Hydrate the OTel parent context from the producer if available;
    // otherwise start cleanly.
    const parentCtx =
      Object.keys(carrier).length > 0
        ? propagation.extract(context.active(), carrier)
        : context.active();

    const tracer = trace.getTracer('bullmq.worker');

    const reqCtxStore = rebuildRequestContextFromJob(envelope, job.id);

    return tracer.startActiveSpan(
      `bullmq.process ${job.queueName}`,
      {
        attributes: {
          'messaging.system': 'bullmq',
          'messaging.destination.name': job.queueName,
          'messaging.bullmq.job.name': job.name,
          'messaging.bullmq.job.id': job.id ?? 'unknown',
          'messaging.bullmq.job.attempt': job.attemptsMade,
        },
      },
      parentCtx,
      async (span) => {
        // Mirror the freshly-started span IDs into the ALS store so logs
        // from inside processJob carry worker-side traceId/spanId rather
        // than producer-side ones.
        const spanCtx = span.spanContext();
        const store = {
          ...reqCtxStore,
          traceId: spanCtx.traceId,
          spanId: spanCtx.spanId,
        };

        // prom-client's own timer, not the clock: it reads process.hrtime, so a
        // job spanning an NTP correction still reports the time it took.
        const stopTimer = queueJobDurationSeconds.startTimer();
        const metricLabels = { queue: job.queueName, job_name: job.name };
        let ok = false;

        try {
          const result = await new Promise<unknown>((resolve, reject) => {
            requestContext.run(store, () => {
              this.processJob(job, token).then(resolve).catch(reject);
            });
          });
          ok = true;
          return result;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: 2 /* SpanStatusCode.ERROR */ });
          // ONE call, shared by the counter and the Sentry gate below, so the
          // metric a dashboard shows and the event that pages someone can never
          // disagree about whether this attempt was the last one.
          const final = isFinalJobAttempt(job, err);
          // Counted on EVERY attempt, unlike Sentry: a queue that fails twice
          // and succeeds on the third try is healthy but not free, and the
          // retry rate is the early warning that precedes a DLQ that nobody
          // wants to discover from `queue_jobs_failed` after removeOnFail has
          // already aged the evidence out.
          queueJobFailuresTotal.inc({ ...metricLabels, final: String(final) });
          // Sentry on the FINAL attempt only (see isFinalJobAttempt; an
          // UnrecoverableError is final on its first throw). A transient
          // failure that a retry will absorb must not page anyone.
          // captureException is a safe no-op without a DSN.
          if (final) {
            Sentry.captureException(err, {
              extra: {
                queue: job.queueName,
                jobName: job.name,
                jobId: job.id ?? 'unknown',
                attempt: job.attemptsMade + 1,
                maxAttempts: job.opts?.attempts ?? 1,
                requestId: store.requestId,
              },
            });
          }
          // Workers run outside the request/exception-filter lifecycle, so a
          // failed job leaves a span in tracing but nothing greppable in logs
          // unless we emit it here.
          this.logger.error(
            'BullMQ job failed',
            {
              queue: job.queueName,
              jobName: job.name,
              jobId: job.id ?? 'unknown',
              attempt: job.attemptsMade,
            },
            err instanceof Error ? err : new Error(String(err)),
          );
          throw err;
        } finally {
          // In `finally` so a throw is timed too: a processor that hangs and
          // then fails is the case worth seeing, and a success-only histogram
          // is exactly the one that would hide it.
          stopTimer({ ...metricLabels, ok: String(ok) });
          span.end();
        }
      },
    );
  }
}
