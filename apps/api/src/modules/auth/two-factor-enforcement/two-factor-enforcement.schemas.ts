import { z } from 'zod';
import type { TwoFactorEnforcementJobData } from './two-factor-enforcement.types';

/**
 * Runtime schema for the sweep payload. The job has no meaningful fields, so the
 * schema is the empty object in zod's default STRIP mode: it drops the
 * `withJobContext` siblings (`_ctx` / `_traceparent`) the producer appended and
 * yields `{}`. Kept for parity with the other per-queue folders and so the
 * processor validates what it read back from Redis through the same
 * `parseJobData` seam (a corrupted/legacy payload fails cleanly to the DLQ
 * instead of being silently trusted).
 */
export const twoFactorEnforcementJobSchema = z.object(
  {},
) satisfies z.ZodType<TwoFactorEnforcementJobData>;
