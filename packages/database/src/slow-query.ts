/**
 * Prisma slow-query observability hook.
 *
 * Emits a structured warn line ONLY for queries above a threshold (default
 * 200 ms), on stdout with the rest of the structured logs. One log line per
 * slow query. Deliberately a signal-on-warn, not a latency histogram: a
 * metrics or tracing pipeline is a deployment's choice, not this package's.
 *
 * Request-context resolution:
 *   `packages/database` is a leaf: it must not depend on `@nestjs/common`,
 *   `@repo/api`, or AsyncLocalStorage shipped in the API. Instead, the API
 *   bootstrap calls `setRequestContextResolver(() => getRequestContext())`
 *   from `apps/api/src/main.ts` to inject correlation. When unset (Prisma
 *   seed scripts, CLI tooling), the warn line still emits, just without
 *   `requestId` / `traceId` / `spanId`.
 */

export interface SlowQueryRequestContext {
  requestId?: string | undefined;
  userId?: string | undefined;
  traceId?: string | undefined;
  spanId?: string | undefined;
}

type ResolverFn = () => SlowQueryRequestContext | undefined;

let resolver: ResolverFn | undefined;
let thresholdMs = 200;

/**
 * Wire up correlation-id resolution. Idempotent; passing `undefined` clears.
 * Call once during bootstrap from the consumer (apps/api/src/main.ts).
 */
export function setRequestContextResolver(fn: ResolverFn | undefined): void {
  resolver = fn;
}

/**
 * Override the slow-query threshold (milliseconds). Defaults to 200 ms.
 * Useful for tests and for tightening on a per-environment basis.
 */
export function setSlowQueryThresholdMs(ms: number): void {
  if (Number.isFinite(ms) && ms >= 0) thresholdMs = ms;
}

/**
 * Build the Prisma `$extends` argument that wraps every query, times it,
 * and emits a structured warn line via `console.warn` when it exceeds the
 * threshold. Output shape matches the API's CustomLogger NDJSON contract so
 * Promtail/Loki ingest it the same way.
 */
export function buildSlowQueryExtension() {
  return {
    name: '@repo/database/slow-query',
    query: {
      async $allOperations({
        model,
        operation,
        args,
        query,
      }: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) {
        const start = Date.now();
        try {
          return await query(args);
        } finally {
          const durationMs = Date.now() - start;
          if (durationMs > thresholdMs) emit(model, operation, durationMs);
        }
      },
    },
  };
}

function emit(model: string | undefined, operation: string, durationMs: number): void {
  const ctx = resolver?.();
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    context: 'Prisma',
    message: 'Slow query',
    data: {
      model: model ?? '$queryRaw',
      operation,
      durationMs,
      thresholdMs,
    },
  };
  if (ctx?.requestId) entry.requestId = ctx.requestId;
  if (ctx?.traceId) entry.traceId = ctx.traceId;
  if (ctx?.spanId) entry.spanId = ctx.spanId;

  console.warn(JSON.stringify(entry));
}
