import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { httpRequestDuration } from './metrics.registry';

function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`;
}

/**
 * Records HTTP request duration into the http_request_duration_seconds
 * Prometheus histogram.
 *
 * Labels used: method (GET/POST/…), route (matched route pattern from
 * req.route.path, e.g. /api/auth/login), status_class (2xx/3xx/4xx/5xx).
 *
 * The interceptor runs after routing so req.route is populated. Raw req.url
 * is intentionally NOT used: it would create one series per unique URL
 * (cardinality bomb).
 *
 * On the error path the status comes from the thrown exception, never from
 * `res.statusCode`: AllExceptionsFilter sets the response status AFTER this
 * `tap` fires, so at this moment `res.statusCode` is still express's default
 * 200 and every thrown error would be counted as a 2xx. That made
 * `http_request_duration_seconds{status_class="5xx"}` structurally near zero
 * and any error-rate SLO on the HTTP surface blind. Guard rejections
 * (ThrottlerGuard 429) never reach an interceptor at all and remain uncounted.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<{ statusCode: number }>();
    const startMs = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res.statusCode, startMs),
        error: (err: unknown) =>
          this.record(
            req,
            err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
            startMs,
          ),
      }),
    );
  }

  private record(req: Request, statusCode: number, startMs: number): void {
    const durationSec = (Date.now() - startMs) / 1000;
    // req.route?.path is the matched pattern (e.g. "/api/trpc/:path*"), not the raw URL
    const route = (req.route?.path as string | undefined) ?? 'unknown';
    httpRequestDuration.labels(req.method, route, statusClass(statusCode)).observe(durationSec);
  }
}
