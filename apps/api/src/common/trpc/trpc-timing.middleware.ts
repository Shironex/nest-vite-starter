import { Injectable } from '@nestjs/common';
import type { TRPCMiddleware, MiddlewareOptions, MiddlewareResponse } from 'nestjs-trpc';
import { trpcProcedureDuration } from '../../modules/metrics/metrics.registry';
import { createAppLogger } from '../../modules/logger/logger.service';

const logger = createAppLogger('tRPC-Timing');

const SLOW_THRESHOLD_MS = 500;

/**
 * Global tRPC middleware that measures procedure call duration.
 *
 * Observations are recorded into the trpc_procedure_duration_seconds Prometheus
 * histogram labeled {procedure, type, ok}. Procedures taking longer than
 * SLOW_THRESHOLD_MS emit a structured warn log.
 *
 * Label cardinality: procedure uses the tRPC path (e.g. ping.ping), type is
 * query|mutation|subscription. No userId, requestId, or raw error messages.
 */
@Injectable()
export class TrpcTimingMiddleware implements TRPCMiddleware {
  async use(opts: MiddlewareOptions): Promise<Awaited<MiddlewareResponse>> {
    const startMs = Date.now();
    const result = await opts.next();
    const durationMs = Date.now() - startMs;
    const durationSec = durationMs / 1000;

    trpcProcedureDuration
      .labels(opts.path ?? 'unknown', opts.type, result.ok ? 'true' : 'false')
      .observe(durationSec);

    if (durationMs > SLOW_THRESHOLD_MS) {
      logger.warn('Slow tRPC procedure', {
        procedure: opts.path,
        type: opts.type,
        durationMs,
      });
    }

    return result;
  }
}
