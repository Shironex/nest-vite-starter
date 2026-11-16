import { Counter, Gauge, Histogram } from 'prom-client';

/**
 * Queue-depth gauges, registered as module-level singletons against the global
 * prom-client registry (same rationale as modules/metrics/metrics.registry.ts:
 * instantiating a metric inside a NestJS provider would double-register on
 * parallel Jest workers, since the registry is global per process). Set by
 * `QueueMetricsService` on each scrape, labeled by queue name.
 */
export const queueJobsWaiting = new Gauge({
  name: 'queue_jobs_waiting',
  help: 'Number of jobs waiting to be processed, labeled by queue',
  labelNames: ['queue'] as const,
});

export const queueJobsActive = new Gauge({
  name: 'queue_jobs_active',
  help: 'Number of jobs currently being processed, labeled by queue',
  labelNames: ['queue'] as const,
});

export const queueJobsFailed = new Gauge({
  name: 'queue_jobs_failed',
  help: 'Number of jobs retained in the failed set (the DLQ), labeled by queue',
  labelNames: ['queue'] as const,
});

export const queueJobsDelayed = new Gauge({
  name: 'queue_jobs_delayed',
  help: 'Number of delayed (backoff-pending) jobs, labeled by queue',
  labelNames: ['queue'] as const,
});

/**
 * How long each job took, and whether it ended well. The four gauges above are
 * DEPTH (they answer "is a backlog forming", which is the shape a slow queue
 * makes), and nothing here answered "how slow" or "how often does a job throw".
 *
 * `ok` rather than a status enum because a job has exactly two ends from the
 * worker's side: it returned, or it threw. `job_name` is safe to label on: the
 * `repo/job-name-must-be-constant` rule keeps every producer on a named constant,
 * so the set is bounded by the source, not by the traffic.
 *
 * Recorded once per ATTEMPT (in TracedWorkerHost.process, which wraps every
 * processor), so a retried job contributes one observation per try. That is the
 * right unit for a duration: three 30-second attempts is thirty seconds of work
 * done three times, not a ninety-second job.
 */
export const queueJobDurationSeconds = new Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Duration of one BullMQ job attempt in seconds, labeled by queue, job name, and whether the attempt returned (ok) or threw',
  labelNames: ['queue', 'job_name', 'ok'] as const,
  // Wider than the HTTP buckets: a mail send or an S3 reconcile is allowed to
  // take seconds, and the interesting tail is minutes rather than the 10s
  // ceiling a request has.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
});

/**
 * Job failures as a COUNTER, which is the gap `queue_jobs_failed` cannot fill.
 * That gauge is a LEVEL on the BullMQ failed set, and every queue here sets
 * `removeOnFail: { age: 604_800 }`, so the set empties itself: a burst that
 * failed a week ago is simply gone, an operator who retries or cleans the DLQ
 * takes it down to zero, and `rate()` over a value that can fall means nothing.
 * The gauge answers "how big is the DLQ right now", which is a real question and
 * a different one. A monotonic counter is what survives the truncation, so
 * "were there failures overnight" stays answerable in the morning.
 *
 * `final` separates the two questions that get conflated. `final="false"` is a
 * transient failure a retry will absorb: worth a rate to watch, never worth
 * paging. `final="true"` means BullMQ is done with this job: it is in the DLQ
 * (or was an UnrecoverableError) and the work will not happen unless a human
 * makes it happen. Incremented from the same `isFinalJobAttempt` call that gates
 * the Sentry event, so the counter and the alert can never disagree.
 */
export const queueJobFailuresTotal = new Counter({
  name: 'queue_job_failures_total',
  help: 'Total BullMQ job attempts that threw, labeled by queue, job name, and whether the attempt was the final one (job now in the DLQ) or a retryable one',
  labelNames: ['queue', 'job_name', 'final'] as const,
});
