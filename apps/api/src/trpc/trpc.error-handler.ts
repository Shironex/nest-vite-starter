import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { TRPCErrorHandler, OnErrorOptions } from 'nestjs-trpc';
import type { TRPCErrorFormatter, TRPCDefaultErrorShape } from '@trpc/server';
import { AppErrorCode } from '@repo/shared/errors';
import { normalizeError } from '@repo/shared/logger';
import { ConcurrencyError } from '../common/database/concurrency-error';
import { PRISMA_ERROR, isPrismaKnownRequestError } from '../common/database/prisma-error';
import { DomainError } from '../common/errors';
import { getRequestId, requestContext } from '../common/context/request-context';
import { createAppLogger } from '../modules/logger/logger.service';

const logger = createAppLogger('tRPC');

const TRPC_TO_APP_ERROR_MAP: Record<string, AppErrorCode> = {
  BAD_REQUEST: AppErrorCode.VALIDATION_ERROR,
  UNAUTHORIZED: AppErrorCode.UNAUTHORIZED,
  FORBIDDEN: AppErrorCode.FORBIDDEN,
  NOT_FOUND: AppErrorCode.NOT_FOUND,
  TIMEOUT: AppErrorCode.INTERNAL_ERROR,
  CONFLICT: AppErrorCode.CONFLICT,
  TOO_MANY_REQUESTS: AppErrorCode.RATE_LIMITED,
  INTERNAL_SERVER_ERROR: AppErrorCode.INTERNAL_ERROR,
  PARSE_ERROR: AppErrorCode.INTERNAL_ERROR,
  METHOD_NOT_SUPPORTED: AppErrorCode.INTERNAL_ERROR,
  PAYLOAD_TOO_LARGE: AppErrorCode.PAYLOAD_TOO_LARGE,
  UNPROCESSABLE_CONTENT: AppErrorCode.INTERNAL_ERROR,
  CLIENT_CLOSED_REQUEST: AppErrorCode.INTERNAL_ERROR,
  PRECONDITION_FAILED: AppErrorCode.INTERNAL_ERROR,
};

/**
 * Resolve the canonical AppErrorCode for a (possibly already promoted)
 * TRPCError. A DomainError cause carries its own appCode; anything else falls
 * back to the tRPC-code mapping above.
 */
export function resolveAppErrorCode(error: { code: string; cause?: unknown }): AppErrorCode {
  if (error.cause instanceof DomainError) {
    return error.cause.appCode;
  }
  return TRPC_TO_APP_ERROR_MAP[error.code] ?? AppErrorCode.INTERNAL_ERROR;
}

/** Default tRPC error shape widened with the canonical AppErrorCode. */
export type AppErrorShape = Omit<TRPCDefaultErrorShape, 'data'> & {
  data: TRPCDefaultErrorShape['data'] & { appCode: AppErrorCode };
};

/**
 * tRPC errorFormatter that exposes the structured AppErrorCode to clients as
 * `error.data.appCode`, so the web app matches on codes instead of
 * substring-matching error messages. Runs AFTER AppErrorHandler.onError has
 * promoted DomainError/ConcurrencyError codes, so `error.code` (and therefore
 * the fallback mapping) reflects the promoted value. Consumed on the client by
 * `getAppErrorCode` (apps/web/src/lib/trpc-errors.ts).
 */
export const appErrorFormatter: TRPCErrorFormatter<object, AppErrorShape> = ({ shape, error }) => ({
  ...shape,
  data: {
    ...shape.data,
    appCode: resolveAppErrorCode(error),
  },
});

/**
 * The only message an INTERNAL_ERROR-class failure is allowed to return to a
 * client. Kept byte-identical to the HTTP boundary's default
 * (common/filters/all-exceptions.filter.ts), so a caller cannot tell which of
 * the two boundaries handled the failure.
 */
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/** Map known Prisma error codes to safe user-facing messages. */
const PRISMA_ERROR_MESSAGES: Record<string, string> = {
  [PRISMA_ERROR.UNIQUE_VIOLATION]: 'Resource already exists',
  [PRISMA_ERROR.RECORD_NOT_FOUND]: 'Resource not found',
};

/**
 * Prisma failures promoted to a client-facing tRPC code, the same way a
 * DomainError or ConcurrencyError cause is promoted below. Promotion does three
 * things at once: the client gets the right HTTP status, `resolveAppErrorCode`
 * derives the matching appCode from the promoted code, and the failure stops
 * being INTERNAL_ERROR-class so it no longer pages Sentry.
 *
 * P2025 is here because it is an ordinary outcome, not a fault: a singular
 * `update`/`delete` whose `where` matched nothing (a stale or foreign id), so
 * leaving it INTERNAL_ERROR-class would return HTTP 500 and raise a Sentry event
 * for a routine 404 - and would hand attackers a way to generate Sentry events
 * with a made-up id.
 *
 * P2002 is deliberately NOT promoted. Reaching this handler with a unique
 * constraint violation means a service failed to guard a constraint it should
 * know about (registration does exactly that, mapping P2002 to EMAIL_IN_USE
 * itself), so the alert is the point.
 */
const PRISMA_CODE_PROMOTIONS: Record<string, string> = {
  [PRISMA_ERROR.RECORD_NOT_FOUND]: 'NOT_FOUND',
};

/**
 * Ship an unexpected (INTERNAL_ERROR-class) procedure failure to Sentry.
 * Expected domain outcomes (DomainError, ConcurrencyError, client-caused tRPC
 * codes) never reach this. Captures the original cause when present so the
 * Sentry issue groups on the real failure, not the tRPC wrapper. Safe no-op
 * when SENTRY_DSN is unset (see otel.ts).
 *
 * `getRequestId()` resolves against the scope `onError` re-opened below, which
 * is what keeps the reported id the request's real one.
 *
 * `errorMessage` is copied into `extra` as a plain string rather than left to
 * be read off the captured object later. When there is no cause the captured
 * object IS `opts.error`, whose message the caller overwrites with the generic
 * client-facing one immediately after this returns, so the snapshot is what
 * guarantees the Sentry issue still names the real failure.
 */
function captureUnexpected(opts: OnErrorOptions): void {
  Sentry.captureException(opts.error.cause ?? opts.error, {
    extra: {
      procedure: opts.path,
      type: opts.type,
      trpcCode: opts.error.code,
      requestId: getRequestId(),
      errorMessage: opts.error.message,
    },
  });
}

/**
 * Prisma's validation error (a malformed query: an unknown argument, a wrong
 * type, a missing required field) prints the offending call's argument tree
 * WITH its values, so an email, a national id or an argon2 hash in a bad query would
 * land in the log verbatim. The shared logger's value scrub catches the fixed
 * shapes (hashes, tokens, emails) but not a national id or a name, so this error's
 * text never reaches a log field whole.
 *
 * Duck-typed on `name` for the same reason `isPrismaKnownRequestError` is: the
 * generated client is ESM-only and this app compiles to CJS.
 */
function isPrismaValidationError(err: unknown): err is Error {
  return err instanceof Error && err.name === 'PrismaClientValidationError';
}

/**
 * The closing problem statement of a Prisma validation message ("Argument
 * `birthDate` is missing.", "Unknown argument `emial`. Did you mean `email`?"),
 * which names arguments and types but not the values the tree above it prints.
 */
function prismaValidationReason(message: string): string {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? 'Prisma validation failed';
}

/** An error's message, safe to put in a structured log field. */
function loggableMessage(error: { message: string; cause?: unknown }): string {
  return isPrismaValidationError(error.cause)
    ? prismaValidationReason(error.cause.message)
    : error.message;
}

/**
 * A thrown cause, flattened for the log (see `normalizeError`). A Prisma
 * validation error keeps its name and stack frames but not the argument tree:
 * an Error's `stack` starts with its full message, so the frames are rebuilt
 * under the reduced one rather than passed through.
 */
function loggableCause(cause: unknown): unknown {
  if (!isPrismaValidationError(cause)) return normalizeError(cause);
  const reason = prismaValidationReason(cause.message);
  const frames = (cause.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  return {
    name: cause.name,
    message: reason,
    stack: [`${cause.name}: ${reason}`, ...frames].join('\n'),
  };
}

/**
 * The correlation id `TrpcRequestContextMiddleware` published onto the tRPC
 * context, or undefined when it never ran.
 *
 * Reading it from `opts.ctx` rather than from the ALS is the whole point: tRPC
 * calls `onError` from `resolveResponse`'s catch block, above every middleware
 * and after the middleware's `requestContext.run` has returned, so the store is
 * gone by the time this handler executes.
 *
 * Undefined only where the middleware could not have run: an unknown procedure
 * path, a rejected HTTP method, or a `createContext` that itself threw. Those
 * failures have no request scope to correlate to in the first place.
 */
function resolveRequestId(opts: OnErrorOptions): string | undefined {
  const published = opts.ctx?.['requestId'];
  return typeof published === 'string' ? published : undefined;
}

@Injectable()
export class AppErrorHandler implements TRPCErrorHandler {
  onError(opts: OnErrorOptions): void {
    const published = resolveRequestId(opts);

    /*
     * Re-open an ALS scope around the whole handler rather than threading the id
     * into each call below. Both consumers resolve it from the ALS at the moment
     * they run: the logger via `createAppLogger`'s `getRequestId` option
     * (modules/logger/logger.service.ts) and `captureUnexpected` directly. So
     * restoring the scope is what makes the error lines carry the same
     * `requestId` as the rest of the request instead of the 'no-context'
     * sentinel, with no change to a single log call.
     *
     * Skipped when a store is somehow already live (a future express mount ahead
     * of the tRPC handler), so a real store carrying userId is never
     * replaced by this id-only one. Also skipped when nothing was published,
     * where `getRequestId()` is already the best available answer.
     */
    if (published === undefined || requestContext.getStore() !== undefined) {
      this.report(opts);
      return;
    }
    requestContext.run({ requestId: published }, () => {
      this.report(opts);
    });
  }

  private report(opts: OnErrorOptions): void {
    // Domain errors raised by services (NotFoundError, ValidationError, etc.)
    // surface here as `cause` because @trpc/server wraps any non-TRPCError
    // throw into INTERNAL_SERVER_ERROR. Promote to the matching tRPC code
    // so the client sees the right HTTP status and the canonical AppErrorCode
    // in the message field. See common/errors/domain-error.ts.
    if (opts.error.cause instanceof DomainError) {
      const domain = opts.error.cause;
      opts.error.message = domain.message;
      (opts.error as { code: string }).code = domain.code;
      logger.warn('tRPC domain error', {
        code: domain.code,
        type: opts.type,
        path: opts.path,
        appCode: domain.appCode,
      });
      return;
    }

    // Concurrency conflicts surface as plain JS errors; promote to CONFLICT
    // so the client sees HTTP 409 and can re-fetch + retry.
    if (opts.error.cause instanceof ConcurrencyError) {
      opts.error.message = 'Resource was modified by another writer';
      (opts.error as { code: string }).code = 'CONFLICT';
      logger.warn('tRPC concurrency conflict', {
        type: opts.type,
        path: opts.path,
        reason: opts.error.cause.message,
      });
      return;
    }

    const appCode = TRPC_TO_APP_ERROR_MAP[opts.error.code] ?? AppErrorCode.INTERNAL_ERROR;

    // Sanitize Prisma errors: log the original, replace with a safe message.
    // The raw Prisma message can name columns and constraints, so it is logged
    // server-side and never returned to the client. It rides a data field, not
    // the message string, so the logger's redaction walks it like any payload.
    if (isPrismaKnownRequestError(opts.error.cause)) {
      const prismaCode = opts.error.cause.code;
      const promotedCode = PRISMA_CODE_PROMOTIONS[prismaCode];

      opts.error.message = PRISMA_ERROR_MESSAGES[prismaCode] ?? INTERNAL_ERROR_MESSAGE;

      // An expected outcome: promote to the client-facing code and do not page.
      if (promotedCode !== undefined) {
        (opts.error as { code: string }).code = promotedCode;
        logger.warn('tRPC promoted Prisma error', {
          code: promotedCode,
          type: opts.type,
          path: opts.path,
          prismaCode,
          prismaMessage: opts.error.cause.message,
        });
        return;
      }

      logger.error('tRPC Prisma error', {
        type: opts.type,
        path: opts.path,
        appCode,
        prismaCode,
        prismaMessage: opts.error.cause.message,
      });

      if (appCode === AppErrorCode.INTERNAL_ERROR) {
        captureUnexpected(opts);
      }
      return;
    }

    // Level from the already-computed appCode, matching the DomainError branch
    // above: a raw TRPCError is most often zod input validation
    // (BAD_REQUEST -> VALIDATION_ERROR) or a PARSE_ERROR, both client-caused.
    // Logging those at ERROR meant one ERROR line per submit for a UI
    // regression that sends a malformed field, drowning the real INTERNAL
    // errors the Sentry gate two blocks below is looking for.
    const log = appCode === AppErrorCode.INTERNAL_ERROR ? logger.error : logger.warn;

    // The ORIGINAL message, before the sanitizing step below can reach it. A
    // service that threw a bare `new Error(...)` named a row, a column or an id
    // in it, and that is the operator's only copy. A data field rather than
    // interpolated into the line, so the logger's redaction walks it.
    log(`tRPC error [${opts.type}] ${opts.path} (${appCode})`, {
      errorMessage: loggableMessage(opts.error),
    });

    if (opts.error.cause) {
      // Flattened (see `loggableCause`), because an Error's own properties are
      // non-enumerable: handed to the logger positionally, one stringifies to
      // `{}` and the stack is gone. When SENTRY_DSN is unset that stack is the
      // entire diagnosis for an unexpected failure.
      log(`tRPC error cause [${opts.type}] ${opts.path}`, {
        err: loggableCause(opts.error.cause),
      });
    }

    if (appCode === AppErrorCode.INTERNAL_ERROR) {
      captureUnexpected(opts);

      /*
       * Sanitize LAST, and only for the INTERNAL_ERROR class.
       *
       * @trpc/server wraps any non-TRPCError throw into INTERNAL_SERVER_ERROR
       * with the thrown message intact, so without this every bare `throw new
       * Error(...)` in a service returns its operator-facing text (internal
       * ids, column names) straight to the browser. The HTTP boundary
       * defaults these to a generic string (common/filters/
       * all-exceptions.filter.ts); this is the same rule for the tRPC boundary,
       * enforced here rather than at each of the ~37 throw sites behind it.
       *
       * Everything that needed the real message has already read it: the log
       * line above, and the Sentry event captured immediately above this.
       *
       * Domain outcomes never arrive here (DomainError and ConcurrencyError
       * return earlier), and a client-caused code (VALIDATION_ERROR,
       * NOT_FOUND, FORBIDDEN) is not INTERNAL_ERROR-class, so its message
       * still passes through verbatim. The web client renders those to users.
       */
      opts.error.message = INTERNAL_ERROR_MESSAGE;
    }
  }
}
