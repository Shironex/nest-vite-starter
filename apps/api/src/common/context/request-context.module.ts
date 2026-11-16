import { Injectable, NestMiddleware, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { redactCredentialPath } from '@repo/shared/logger';
import { requestContext } from './request-context';
import type { IRequestContext } from './request-context';

/**
 * Parse a W3C traceparent header.
 *
 * Format: `version-traceId-parentSpanId-flags` e.g.
 *   `00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01`
 *
 * Returns the trace-id when valid (32 lowercase hex), otherwise undefined.
 * The parser is intentionally strict: any deviation falls back to the request
 * receiving its own fresh ID. We do not fail the request.
 */
function parseTraceparent(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const parts = header.split('-');
  if (parts.length !== 4) return undefined;
  const [version, traceId, spanId, flags] = parts;
  if (
    version?.length !== 2 ||
    traceId?.length !== 32 ||
    spanId?.length !== 16 ||
    flags?.length !== 2
  ) {
    return undefined;
  }
  if (traceId === '00000000000000000000000000000000') return undefined;
  if (!/^[0-9a-f]+$/.test(traceId)) return undefined;
  return traceId;
}

/** Shape a caller-supplied correlation id may take: id-like characters only. */
const INBOUND_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Accept a client's `x-request-id` only when it looks like an identifier.
 *
 * `requestId` is persisted as `AuditLog.correlationId` and stamped onto queue
 * envelopes, so an unvalidated header lets a caller write arbitrary unbounded
 * text into the audit trail, or deliberately collide with another request's id
 * to blur it. Rejecting a malformed value falls back to a fresh UUID rather
 * than failing the request: correlation is a convenience, not a control.
 */
function sanitizeInboundRequestId(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  return INBOUND_REQUEST_ID_PATTERN.test(header) ? header : undefined;
}

/** Per-HTTP-request identity, memoized on the request object. */
interface IRequestIdentity {
  readonly requestId: string;
  readonly dedupeNonce: string;
}

const REQUEST_IDENTITY = Symbol('requestIdentity');

/**
 * Resolve the ids that must be stable for the whole HTTP request.
 *
 * Memoized on `req` because the tRPC scope is opened per PROCEDURE: a batched
 * call would otherwise mint a fresh id per procedure, scattering one user action
 * across several unrelated `AuditLog.correlationId`s and making its log lines
 * unjoinable, the exact property per-procedure scoping is supposed to preserve.
 *
 * `dedupeNonce` is deliberately separate from `requestId` and ALWAYS
 * server-minted. `requestId` may come from a caller-supplied `traceparent` or
 * `x-request-id`, which is fine for a label but not for a KEY: `MailService`
 * derives BullMQ job ids from the request scope to collapse producer retries,
 * and BullMQ treats a repeated job id as a no-op. Keying that on a value the
 * caller chooses would let someone pin one header and silently swallow their own
 * "two-factor disabled" and "recovery code used" security alerts.
 */
function resolveRequestIdentity(
  req: Request,
  inboundTraceId: string | undefined,
): IRequestIdentity {
  const carrier = req as Request & { [REQUEST_IDENTITY]?: IRequestIdentity };
  const cached = carrier[REQUEST_IDENTITY];
  if (cached !== undefined) return cached;

  // Source of truth for `requestId`:
  //   1. Lower 8 bytes (16 hex chars) of the active/inbound trace-id when
  //      present. Keeps logs joinable to traces without inventing a second
  //      identifier per request.
  //   2. The legacy x-request-id header when no trace exists.
  //   3. Fresh UUID otherwise.
  const identity: IRequestIdentity = {
    requestId: inboundTraceId
      ? inboundTraceId.slice(16) // lower 8 bytes
      : (sanitizeInboundRequestId(req.headers['x-request-id']) ?? randomUUID()),
    dedupeNonce: randomUUID(),
  };

  carrier[REQUEST_IDENTITY] = identity;
  return identity;
}

/**
 * Build the ALS store for one inbound request.
 *
 * Exported because the express middleware below is NOT the only entrypoint that
 * has to establish this scope: nestjs-trpc mounts its own handler outside Nest's
 * middleware pipeline, so `/trpc` never reaches `forRoutes('*')` and has to open
 * the scope itself (see common/trpc/trpc-request-context.middleware.ts). Both
 * callers share this builder so the two stores cannot drift.
 *
 * `pathOverride` exists for that tRPC caller. `req.originalUrl` is the wrong
 * source there: the web client batches QUERIES over `httpBatchLink`, which
 * serializes every input into the query string, so the URL of a read
 * carries identifiers and search terms. `path` exists to be logged, so
 * taking it from the URL would leak them by the back door. The procedure name is both
 * safer and the more useful correlation key.
 *
 * For every other entrypoint the same reasoning applies one level down:
 * `req.path`, not `req.originalUrl`. The query string is a credential channel
 * of its own (the OAuth callback's `code=`/`state=`, a hand-built `?input=`),
 * and `path` exists to be logged, so nothing that rides a query string may
 * enter the store.
 *
 * The trace back door is closed by the same reasoning in
 * common/observability/otel-http-redaction.ts, which redacts the URL attributes
 * of every incoming http span.
 */
export function buildRequestContextStore(req: Request, pathOverride?: string): IRequestContext {
  // The OTel http instrumentation has already extracted the inbound
  // traceparent into the active context by the time express middleware
  // runs, so the active span (if any) reflects the propagated trace.
  const activeSpan = trace.getActiveSpan();
  const activeSpanCtx = activeSpan?.spanContext();

  const inboundTraceId =
    activeSpanCtx?.traceId ?? parseTraceparent(req.headers['traceparent'] as string | undefined);

  const { requestId, dedupeNonce } = resolveRequestIdentity(req, inboundTraceId);

  return {
    requestId,
    dedupeNonce,
    method: req.method,
    path: pathOverride ?? redactCredentialPath(req.path),
    ip: req.ip ?? undefined,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? undefined,
    traceId: activeSpanCtx?.traceId ?? inboundTraceId,
    spanId: activeSpanCtx?.spanId,
  };
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    requestContext.run(buildRequestContextStore(req), () => next());
  }
}

@Module({})
export class RequestContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
