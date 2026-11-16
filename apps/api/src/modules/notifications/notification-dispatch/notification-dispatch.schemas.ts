import { z } from 'zod';
import { notificationTypeSchema } from '@repo/shared/schemas';
import type { INotificationDispatchJobData } from './notification-dispatch.types';

/**
 * Runtime schema for the notification-dispatch job payload. Mirrors the
 * email-delivery convention: the interface types the producer, the schema
 * validates what the worker reads back from Redis (default zod strip mode
 * drops the reserved `withJobContext` siblings). A mismatch fails the job
 * straight to the DLQ via `parseJobData` (common/queue/job-payload.ts).
 *
 * `type` is validated against the shared union HERE, at the queue boundary,
 * so the TEXT column in Postgres only ever receives sanctioned values.
 */
export const notificationDispatchJobSchema = z.object({
  userId: z.string().min(1),
  notification: z.object({
    type: notificationTypeSchema,
    title: z.string().min(1),
    message: z.string().min(1),
  }),
}) satisfies z.ZodType<INotificationDispatchJobData>;
