import { context, propagation } from '@opentelemetry/api';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { getRequestContext, type IRequestContext } from '../context/request-context';

const logger = new Logger('JobContext');

/**
 * Shape stamped onto `job.data._ctx` by `withJobContext()` and read by
 * `TracedWorkerHost` in the worker process.
 *
 * Keep this strictly to identifiers that survive serialization to Redis. No
 * full request objects, no DB references, no high-cardinality strings:
 * BullMQ stores `job.data` as JSON in Redis and oversized payloads inflate
 * memory and slow throughput at the queue.
 *
 * tenantId/workspaceId carry the tenant scope across the queue boundary so queued
 * work re-enters the same tenant context (Prisma tenant-scope extension, audit
 * rows, tenant-scoped log enrichment) as the producer.
 */
export interface IJobContextEnvelope {
  requestId?: string;
  userId?: string;
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  workspaceId?: string;
}

/**
 * Internal carrier shape used by OTel propagation to inject/extract a
 * `traceparent` (and optional `tracestate`) onto BullMQ job data.
 */
export type TracePropagationCarrier = Record<string, string>;

/**
 * Stamp the current ALS IRequestContext + active OTel context onto a BullMQ
 * job data payload. Use this from any producer (HTTP handler, cron, another
 * worker) before calling `Queue.add(name, data)`.
 *
 * @example
 * ```ts
 * await this.emailQueue.add('send-welcome', withJobContext({ userId }));
 * ```
 *
 * The returned object is a shallow copy with two reserved keys appended:
 *   - `_ctx`: IRequestContext snapshot (requestId/userId/...)
 *   - `_traceparent`: W3C traceparent injected from the active OTel context
 *
 * Both are read by `TracedWorkerHost.process` in the worker. Picking
 * underscore-prefixed names so they don't collide with caller payload fields.
 */
export function withJobContext<T extends Record<string, unknown>>(
  data: T,
): T & {
  _ctx?: IJobContextEnvelope;
  _traceparent?: string;
  _tracestate?: string;
} {
  const reqCtx = getRequestContext();

  const envelope: IJobContextEnvelope = {};
  if (reqCtx?.requestId) envelope.requestId = reqCtx.requestId;
  if (reqCtx?.userId) envelope.userId = reqCtx.userId;
  if (reqCtx?.traceId) envelope.traceId = reqCtx.traceId;
  if (reqCtx?.spanId) envelope.spanId = reqCtx.spanId;
  if (reqCtx?.tenantId) envelope.tenantId = reqCtx.tenantId;
  if (reqCtx?.workspaceId) envelope.workspaceId = reqCtx.workspaceId;

  const carrier: TracePropagationCarrier = {};
  // Inject the currently-active context (which is the per-request span when
  // called from inside an HTTP handler) so the worker can attach its spans
  // as children of the producer's span.
  propagation.inject(context.active(), carrier);

  const out: T & {
    _ctx?: IJobContextEnvelope;
    _traceparent?: string;
    _tracestate?: string;
  } = { ...data };

  if (Object.keys(envelope).length > 0) {
    out._ctx = envelope;
  }
  if (carrier['traceparent']) {
    out._traceparent = carrier['traceparent'];
  }
  if (carrier['tracestate']) {
    out._tracestate = carrier['tracestate'];
  }
  return out;
}

/**
 * The envelope as it comes BACK off the queue, parsed rather than asserted.
 *
 * Defense in depth. The producer stamps this server-side from the ALS, so
 * nothing a client sends reaches it, and no code path writes an envelope this
 * schema would reject. What it defends against is the queue itself as an input:
 * a job replayed from a queue UI with edited data, a payload written by an
 * older or newer producer, or anything with Redis write access. `tenantId` from
 * this envelope becomes the ALS scope the Prisma tenant-scope extension splices
 * into every `where`, and that extension is the sole tenancy boundary (there is
 * no RLS), so a non-string here would be a Prisma filter object rather than an
 * id. Every other Redis-sourced blob in the api (sessions, grants) is
 * schema-parsed for the same reason.
 *
 * `.strict()` so a field the producer stopped writing cannot ride along
 * unnoticed, and the whole envelope is dropped rather than repaired: a partly
 * trusted context is worse than none, and none is a legal, handled state.
 */
const jobContextEnvelopeSchema = z
  .object({
    requestId: z.string().max(128).optional(),
    userId: z.string().min(1).optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    tenantId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
  })
  .strict();

/**
 * Reconstruct a `IRequestContext` store from the envelope on a job. Falls back
 * to a minimal context with a deterministic requestId so worker logs are
 * never identifier-less, even when the producer didn't run `withJobContext`.
 *
 * Takes `unknown`: the caller reads it off `job.data`, which is JSON out of
 * Redis, and a signature that took the interface would only be asking the
 * caller to do the cast this function exists to avoid.
 */
export function rebuildRequestContextFromJob(
  envelope: unknown,
  jobId: string | undefined,
): IRequestContext {
  const fallbackRequestId = jobId ? `job-${jobId}` : 'job-no-context';

  // `z.infer` of an all-optional object, not IJobContextEnvelope: under
  // `exactOptionalPropertyTypes` a parsed field is `string | undefined` while
  // the interface's is `string`, and the two are deliberately different types.
  let parsed: z.infer<typeof jobContextEnvelopeSchema> | undefined;
  if (envelope !== undefined && envelope !== null) {
    const result = jobContextEnvelopeSchema.safeParse(envelope);
    if (result.success) {
      parsed = result.data;
    } else {
      // Warn, then continue with NO context. Failing the job would turn a
      // malformed header into lost work, and the processor's own payload
      // schema still guards what the job actually does.
      logger.warn(
        'Dropping a malformed job context envelope; the job runs without tenant or trace context.',
        { requestId: fallbackRequestId },
      );
    }
  }

  return {
    requestId: parsed?.requestId ?? fallbackRequestId,
    userId: parsed?.userId,
    traceId: parsed?.traceId,
    spanId: parsed?.spanId,
    tenantId: parsed?.tenantId,
    workspaceId: parsed?.workspaceId,
  };
}
