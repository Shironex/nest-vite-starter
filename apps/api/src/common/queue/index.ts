// Public surface for the queue helpers. Processors extend `QueueProcessor`
// (with `@Processor(QUEUE_NAMES.X)`). Queue names come from `QUEUE_NAMES`, never
// inline literals. See ./CONVENTIONS.md for the idempotency contract and
// ./example.processor.ts for the documented pattern. The real reference is
// modules/mail/email-delivery/.
export { QueueProcessor, isFinalJobAttempt } from './queue-processor';
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
export { inlineQueueWorker, runsInlineQueueWorker, QUEUE_WORKER_MODES } from './queue-worker';
export { QueueMetricsService, type IQueueCounts } from './queue-metrics.service';
