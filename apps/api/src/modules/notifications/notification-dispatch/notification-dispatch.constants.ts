import type { IQueueDefaults } from '../../../common/queue/queue.constants';
import { QUEUE_NAMES } from '../../../common/queue/queue.constants';

export const NOTIFICATION_DISPATCH_QUEUE_NAME = QUEUE_NAMES.NOTIFICATION_DISPATCH;

export const NOTIFICATION_DISPATCH_JOB_NAMES = {
  DISPATCH: 'dispatch',
} as const;

export type NotificationDispatchJobName =
  (typeof NOTIFICATION_DISPATCH_JOB_NAMES)[keyof typeof NOTIFICATION_DISPATCH_JOB_NAMES];

export const NOTIFICATION_DISPATCH_DEFAULTS: IQueueDefaults = {
  jobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 100 },
    // Bounded DLQ (7 days): failed payloads can carry PII, so the failed set is
    // capped rather than retained forever. Mirrors EMAIL_DELIVERY_DEFAULTS.
    removeOnFail: { age: 604_800 },
  },
  concurrency: 5,
};
