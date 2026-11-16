import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type { Response, Request } from 'express';
import { AppErrorCode } from '@repo/shared/errors';
import { normalizeError, redactCredentialPath } from '@repo/shared/logger';
import { createAppLogger } from '../../modules/logger/logger.service';
import { getRequestContext } from '../context/request-context';
import { redactUrlText } from '../observability/otel-http-redaction';

const logger = createAppLogger('ExceptionFilter');

/**
 * Run every string of a normalized error through `redactUrlText`. Nest's own
 * unmatched-route handler throws `Cannot <METHOD> <req.originalUrl>`, so the
 * request target (a path-segment credential, a query string) rides the message,
 * the stack and a wrapped cause as well as `path`. `normalizeError` yields at
 * most two levels (the error and one cause), so the walk stops there instead of
 * recursing into an arbitrary thrown value.
 */
function redactUrlsInError(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactUrlText(value);
  if (value === null || typeof value !== 'object' || depth > 1) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, redactUrlsInError(inner, depth + 1)]),
  );
}

/**
 * An http-errors instance that the library itself marked safe to return.
 *
 * Express and several of its middlewares throw http-errors rather than
 * HttpException, and those are NOT instances of anything Nest recognizes, so
 * `mapExternalException` hands them to this filter untouched and the
 * HttpException check below would call every one of them a 500. body-parser is
 * only the loudest producer (an over-cap body is a 413 `entity.too.large`);
 * express itself throws a 400 on a malformed `Content-Type`, and a 404 out of
 * `res.sendFile`.
 *
 * `expose` is the library's own statement that `message` is meant for the
 * client, and http-errors sets it only for 4xx. Both conditions are checked
 * anyway, so a 5xx can never arrive here with its internal message exposed.
 * Deliberately structural rather than a name check on PayloadTooLargeError:
 * the class here is "http-errors client error", not one constructor.
 */
interface IExposedClientError {
  status: number;
  expose: true;
  message: string;
}

function isExposedClientError(exception: unknown): exception is IExposedClientError {
  if (typeof exception !== 'object' || exception === null) return false;
  const candidate = exception as { status?: unknown; expose?: unknown; message?: unknown };
  return (
    candidate.expose === true &&
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500 &&
    typeof candidate.message === 'string'
  );
}

/**
 * The HTTP boundary's status -> AppErrorCode table, so a REST failure names
 * itself the same way the tRPC boundary does (`error.data.appCode`, see
 * trpc/trpc.error-handler.ts) instead of leaving the client to switch on a
 * numeric status or, worse, on the message text.
 *
 * A status with no faithful code emits no `appCode` at all rather than a
 * plausible-looking wrong one: an absent field is a client falling back to the
 * status, an incorrect one is a client acting on a lie.
 */
const STATUS_APP_ERROR_CODES: Record<number, AppErrorCode> = {
  [HttpStatus.BAD_REQUEST]: AppErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: AppErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: AppErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: AppErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: AppErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: AppErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: AppErrorCode.RATE_LIMITED,
};

function appErrorCodeFor(status: number): AppErrorCode | undefined {
  if (status >= HttpStatus.INTERNAL_SERVER_ERROR) return AppErrorCode.INTERNAL_ERROR;
  return STATUS_APP_ERROR_CODES[status];
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isDev = this.configService.get<string>('NODE_ENV') !== 'production';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : isExposedClientError(exception)
          ? exception.status
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : isExposedClientError(exception)
          ? exception.message
          : 'Internal server error';

    const appCode = appErrorCodeFor(status);

    // A path-segment credential (a feed token, a download ticket) must not
    // reach logs or Sentry. A wrong or revoked token
    // 404s through here on every probe, so this is the highest-volume place it
    // would have leaked.
    //
    // `request.path`, never `request.url`: the query string is a second
    // credential channel this filter sees on every refusal. The global
    // ThrottlerGuard and the unknown-provider 404 both land here for
    // `GET /api/auth/oauth/:provider/callback?code=...&state=...`, and the
    // batched tRPC GET carries `?input=<JSON of every procedure input>`.
    // `redactSensitive` is key-based, so a string called `path` is never
    // scrubbed on the way out.
    const path = redactCredentialPath(request.path);

    /*
     * `message` is what the CLIENT was told; `err` is what actually happened.
     * For anything that is not an HttpException those differ (the client gets
     * the generic string above), so logging only `message` would leave the
     * real failure nowhere. `normalizeError` flattens the Error because its own
     * properties are non-enumerable and would otherwise serialize to `{}`.
     *
     * `userId` survives the redactor by design: it is an identifier, not a
     * secret (the audit trail stores it raw in a queryable column), and it is
     * the only field here that answers "which account is hitting this 500".
     * See SENSITIVE_KEY_PATTERNS in @repo/shared/logger.
     */
    // Level from the status: 401/403/404/429 are client errors, and
    // LoggerMiddleware already records the same request at warn. Logging every
    // one of them at ERROR meant a scanner walking 404s or a throttled client
    // filled the ERROR stream with stacks, which made an ERROR-rate alert on
    // the HTTP surface untrustworthy. Matches the tRPC boundary, which picks
    // its level from the appCode.
    const reqCtx = getRequestContext();
    const log = status >= 500 ? logger.error : logger.warn;
    log('Unhandled exception', {
      requestId: reqCtx?.requestId,
      userId: reqCtx?.userId,
      traceId: reqCtx?.traceId,
      spanId: reqCtx?.spanId,
      statusCode: status,
      appCode,
      message: redactUrlText(message),
      path,
      method: request.method,
      err: redactUrlsInError(normalizeError(exception)),
    });

    // 5xx only: a 4xx is a client error (validation, missing auth, bad route)
    // and would drown the Sentry quota in noise. captureException is a safe
    // no-op when SENTRY_DSN is unset (see otel.ts).
    if (status >= 500) {
      Sentry.captureException(exception, {
        extra: {
          requestId: reqCtx?.requestId,
          path,
          method: request.method,
          statusCode: status,
        },
      });
    }

    response.status(status).json({
      error: {
        message,
        code: status,
        ...(appCode && { appCode }),
        ...(isDev &&
          exception instanceof Error && {
            stack: exception.stack,
            path,
          }),
      },
    });
  }
}
