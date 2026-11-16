// Public surface for the queue helpers. Producers call `withJobContext(payload)`
// before `Queue.add(...)`; processors extend `TracedWorkerHost` (with
// `@Processor(QUEUE_NAMES.X)`). Queue names come from `QUEUE_NAMES`, never inline
// literals. See ./CONVENTIONS.md for the idempotency contract and ./example.processor.ts
// for the documented pattern. The real reference is modules/mail/email-delivery/.
export {
  withJobContext,
  rebuildRequestContextFromJob,
  type IJobContextEnvelope,
  type TracePropagationCarrier,
} from './job-context';
export { TracedWorkerHost, isFinalJobAttempt } from './traced-worker.host';
export { parseJobData } from './job-payload';
export {
  QUEUE_NAMES,
  type QueueName,
  type IQueueDefaults,
  type IBoundedRetention,
  type QueueConcurrency,
  type QueueJobDefaults,
} from './queue.constants';
export { registerQueueWithDefaults } from './register-queue';
export { removeStaleJobSchedulers } from './stale-job-schedulers';
export { QueueMetricsService, type IQueueCounts } from './queue-metrics.service';
