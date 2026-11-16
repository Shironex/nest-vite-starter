import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import type { z } from 'zod';

/**
 * Validate a BullMQ job's Redis-persisted payload against its zod schema at
 * the top of a processor case. `job.data` round-trips through Redis as JSON,
 * so the compile-time cast the processor used to do proved nothing about what
 * actually comes back (older producer versions, manual replays, corrupted
 * entries).
 *
 * A mismatch throws `UnrecoverableError`: BullMQ fails the job straight to
 * the failed set (the DLQ) with NO retries, because re-running an invalid
 * payload can never succeed and would only burn the retry budget. The error
 * message carries issue paths + codes only, never payload values (job data
 * contains recipient addresses).
 *
 * Returns the PARSED data (zod strip mode), so `withJobContext`'s reserved
 * `_ctx` / `_traceparent` siblings are dropped and can never leak into
 * processor logic.
 */
export function parseJobData<TSchema extends z.ZodType>(
  schema: TSchema,
  job: Job,
): z.output<TSchema> {
  const result = schema.safeParse(job.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      .join('; ');
    throw new UnrecoverableError(
      `Invalid ${job.queueName}#${job.name} payload (id=${job.id ?? 'unknown'}): ${issues}`,
    );
  }
  return result.data;
}
