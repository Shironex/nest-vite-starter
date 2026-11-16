// IMPORTANT: ./load-env is the ONLY import allowed above ./otel, and it must
// stay there. It populates process.env from the repo's .env files, and every
// module-scope env reader below depends on that having already happened:
// ./otel reads OTEL_* / SENTRY_* at import time, and bootstrap() dynamic-
// imports @repo/database, which throws on a missing DATABASE_URL at ITS module
// scope, both before ConfigModule.forRoot() ever runs. It touches only
// node:fs / node:path, so it captures none of the modules ./otel patches.
import { loadedEnvFiles } from './load-env';

// IMPORTANT: ./otel must be imported before any @nestjs/* import, and before
// any module that itself imports @nestjs/*. The OTel auto-instrumentations
// monkey-patch http / pg / ioredis / nestjs-core / prisma at require time; if
// Nest loads first those modules capture references to the un-patched
// originals and tracing silently misses spans.
import './otel';

import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { esmImport } from './common/utils/esm-import';
import { getRequestContext } from './common/context/request-context';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { CustomLogger, createAppLogger } from './modules/logger/logger.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CsrfService } from './common/security/csrf.service';
import { configureBodyParsers } from './common/http/body-parsers';
import { installUnhandledRejectionPolicy } from './common/observability/unhandled-rejection';

// Two years, in seconds.
const HSTS_MAX_AGE_SECONDS = 63072000;

async function bootstrap() {
  // Wire the @repo/database slow-query log emitter to read correlation IDs
  // from this app's ALS store. Done dynamically because @repo/database is
  // ESM-only and apps/api compiles to CJS. When no request is active
  // (e.g. PrismaService.onModuleInit health probe) the resolver returns
  // undefined and the slow-query line still emits, just without ids.
  const dbModule = (await esmImport('@repo/database')) as {
    setRequestContextResolver: (
      fn: () =>
        | {
            requestId?: string | undefined;
            userId?: string | undefined;
            traceId?: string | undefined;
            spanId?: string | undefined;
          }
        | undefined,
    ) => void;
  };
  dbModule.setRequestContextResolver(() => {
    const ctx = getRequestContext();
    if (!ctx) return undefined;
    return {
      requestId: ctx.requestId,
      userId: ctx.userId,
      traceId: ctx.traceId,
      spanId: ctx.spanId,
    };
  });

  // Buffer Nest's own bootstrap/internal logs (emitted during create(), before
  // the DI container is up) instead of letting the default ConsoleLogger print
  // them in its own format. Once the app is constructed we swap in the
  // DI-managed CustomLogger via `app.useLogger(...)`, which flushes the buffered
  // lines through it, so every line, framework lines included, goes through
  // the structured logger and the OTel/Sentry pipeline in every mode (dev too).
  //
  // `bodyParser: false` so Nest registers no parser of its own. Its defaults
  // are registered during `init()`, i.e. after every `app.use` below but with
  // limits nothing in this repo states, and a second parser registered later
  // would never see a body the first one already rejected. Turning them off
  // makes configureBodyParsers() the single place that decides both the caps
  // and where in the chain a body is read. See common/http/body-parsers.ts.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  const logger = app.get(CustomLogger);
  app.useLogger(logger);

  // Which .env files were applied, in precedence order, first-wins. Logged
  // because the precedence is CWD-local before workspace root and a stray
  // app-local file therefore overrides the repo's silently. See ./load-env.ts.
  logger.log(
    loadedEnvFiles.length > 0
      ? `Environment loaded from (first wins): ${loadedEnvFiles.join(', ')}`
      : 'No .env file found; using the process environment as-is',
    'Bootstrap',
  );

  const configService = app.get(ConfigService);
  app.useGlobalFilters(new AllExceptionsFilter(configService));

  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  // Trust the proxy chain so req.ip and req.protocol reflect the client,
  // not the reverse proxy. Rate-limit and audit IPs depend on this.
  //
  // The `loopback` DEFAULT is only correct when the reverse proxy reaches this
  // process over 127.0.0.1. Behind a reverse proxy on a Docker bridge
  // network it does not: express then refuses to trust the hop, `req.ip`
  // becomes the proxy's bridge address for every request, and every per-IP
  // limiter (login, register, forgot-password, 2FA at 10/60 s, download)
  // collapses into ONE shared bucket. A
  // single unauthenticated client sending ten login attempts a minute then
  // locks login, registration and password reset for the whole deployment, and
  // every audit row records the proxy IP instead of the caller's. Set
  // TRUST_PROXY=1 (or the proxy's subnet) on any deployment that is not
  // loopback-fronted. See the deployment runbook.
  const trustProxy = configService.get<string>('TRUST_PROXY', 'loopback');
  app.set('trust proxy', trustProxy);

  // ---------------------------------------------------------------------------
  // Security headers (helmet: explicit config, not defaults)
  //
  // CSP keeps script-src to self; the SPA bundle is same-origin and we don't
  // load 3rd-party scripts on the API surface. Turnstile/Sentry/etc widen this
  // on the web side via nginx, not here.
  // ---------------------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'"],
          'font-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          // The SPA is served by its own nginx image today, so this policy does
          // not front index.html in the split deployment. It is kept in step
          // with the web one anyway, because an api that ever serves the built
          // SPA must not be the deployment where the document preview silently
          // stops drawing. blob: is the inline preview's local handle, and
          // 'self' is what frame-src inherited from default-src before this
          // directive existed. object-src stays 'none' on purpose: <object>
          // would draw an uploaded document in this origin.
          'frame-src': ["'self'", 'blob:'],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'upgrade-insecure-requests': isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false, // would break presigned-url media loads
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      strictTransportSecurity: isProduction
        ? { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true, preload: true }
        : false,
      xFrameOptions: { action: 'deny' },
    }),
  );

  // Permissions-Policy isn't covered by helmet's defaults, so it is set explicitly.
  // Keep this allowlist minimal; widen per-feature when a real flow needs it.
  app.use((_req: Request, res: Response, next: () => void) => {
    res.setHeader(
      'Permissions-Policy',
      [
        'accelerometer=()',
        'autoplay=()',
        'camera=()',
        'display-capture=()',
        'fullscreen=(self)',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=()',
        'usb=()',
      ].join(', '),
    );
    next();
  });

  // CORS: explicit origin allowlist for the web client
  const corsOrigins = (() => {
    if (!isProduction) {
      return ['http://localhost:5173'];
    }
    const configured = configService.get<string>('CORS_ORIGINS');
    if (configured) {
      return configured.split(',').map((s) => s.trim());
    }
    return [configService.getOrThrow<string>('APP_URL')];
  })();

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Cookie parser (must come before CSRF)
  app.use(cookieParser());

  // CSRF: ensure pre-session sid cookie, then double-submit protection.
  const csrfService = app.get(CsrfService);
  app.use((req: Request, res: Response, next: () => void) => {
    csrfService.ensureSessionIdentifier(req, res, () => {
      csrfService.protect(req, res, next);
    });
  });

  // The CSRF token endpoint (GET /api/csrf-token) is served by CsrfController
  // (common/security/csrf.controller.ts) so the global ThrottlerGuard applies;
  // GET requests pass the `protect` middleware above untouched.

  // Body parsers LAST, after CSRF, so nothing buffers the body of a request
  // CSRF is about to refuse. This is also where Nest's own json/urlencoded
  // parsers effectively ran before `bodyParser: false`; a parser that ran
  // earlier would buffer an anonymous oversized POST before it met CSRF.
  configureBodyParsers(app);

  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`, 'Bootstrap');
}
// A promise that rejected with nobody listening: log it, drain Sentry, exit 1,
// with or without SENTRY_DSN (otel.ts pins Sentry's own listener to capture
// only). Deliberate fire-and-forget work goes through detach() and never
// arrives here. See common/observability/unhandled-rejection.ts for why exit.
installUnhandledRejectionPolicy({
  logger: createAppLogger('Process'),
  flush: (timeoutMs) => Sentry.flush(timeoutMs),
  exit: (code) => process.exit(code),
});

bootstrap().catch((err: unknown) => {
  // A bootstrap failure can happen before the DI container (and CustomLogger)
  // exists, so log through the module-scope structured factory: in production
  // this emits one redacted NDJSON line instead of raw ANSI text. Exit non-zero
  // so the orchestrator restarts the container instead of keeping a half-built
  // process alive on whatever handles (Redis, OTel timers) were already opened.
  const fatalLogger = createAppLogger('Bootstrap');
  fatalLogger.error(
    'Fatal: API bootstrap failed',
    err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  );
  process.exit(1);
});
