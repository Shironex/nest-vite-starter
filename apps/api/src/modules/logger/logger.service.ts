import { Injectable, LoggerService } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { createLogger, normalizeError, setTimestampsEnabled } from '@repo/shared/logger';
import type { Logger, TraceContext } from '@repo/shared/logger';
import { getRequestId, getRequestContext } from '../../common/context/request-context';

// Enable timestamps for API logs
setTimestampsEnabled(true);

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Resolve trace context for log enrichment, preferring the OTel active span
 * (always fresh) and falling back to the values RequestContextMiddleware
 * stamped onto the ALS store at request entry. The active span lookup wins
 * because nested operations (BullMQ workers, Prisma queries) start child
 * spans whose IDs differ from the root request span.
 */
function resolveTraceContext(): TraceContext | undefined {
  const activeSpan = trace.getActiveSpan();
  const ctx = activeSpan?.spanContext();
  if (ctx?.traceId && ctx?.spanId) {
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  }
  const stored = getRequestContext();
  if (stored?.traceId || stored?.spanId) {
    return { traceId: stored.traceId, spanId: stored.spanId };
  }
  return undefined;
}

/**
 * Canonical module-scope logger factory for the API. Wires the same options
 * CustomLogger uses: structured NDJSON in production (so error paths ride the
 * redaction pipeline instead of emitting ANSI text), plus dynamic requestId
 * and trace-context resolution from the ALS store / active OTel span.
 *
 * For code that runs at import time, before the DI container exists (exception
 * filter, tRPC error handler, module-scope middlewares), where ConfigService is
 * not injectable. This file is the one place outside @repo/shared allowed to
 * read NODE_ENV directly (see repo/no-direct-process-env), so the production
 * check stays owned here.
 */
export function createAppLogger(context: string): Logger {
  return createLogger(context, {
    structured: isProduction,
    getRequestId,
    getTraceContext: resolveTraceContext,
  });
}

@Injectable()
export class CustomLogger implements LoggerService {
  private readonly loggers = new Map<string, Logger>();

  private getLogger(context: string): Logger {
    let logger = this.loggers.get(context);
    if (!logger) {
      logger = createAppLogger(context);
      this.loggers.set(context, logger);
    }
    return logger;
  }

  /**
   * Split NestJS-style optional params into structured `extras` and the trailing
   * `context`. NestJS's `Logger` appends the instance's context as the final
   * string param; everything before it is data or an Error/stack. Empty/nullish
   * extras are dropped, and Errors are normalized (`normalizeError` from
   * @repo/shared/logger, the same flattening the structured sink applies) so
   * they land in the logger's `data` channel instead of being stringified away.
   */
  private split(optionalParams: unknown[]): { context: string; extras: unknown[] } {
    let context = 'App';
    let rest = optionalParams;
    if (rest.length > 0 && typeof rest[rest.length - 1] === 'string') {
      context = rest[rest.length - 1] as string;
      rest = rest.slice(0, -1);
    }
    const extras = rest
      .filter((v) => v !== undefined && v !== null && v !== '')
      .map(normalizeError);
    return { context, extras };
  }

  private write(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const { context, extras } = this.split(optionalParams);
    this.getLogger(context)[level](message as string, ...extras);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }
}
