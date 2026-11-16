// OpenTelemetry + Sentry bootstrap.
//
// Imported FIRST in main.ts (before any @nestjs/* import) so:
//   - the OTel auto-instrumentations can monkey-patch http / pg / ioredis /
//     nestjs-core / prisma before the app's own modules load and capture
//     references to the originals;
//   - Sentry.init() runs before any @nestjs/* module loads AND before the OTel
//     NodeSDK is constructed below.
// Reordering this import will silently break tracing and/or error capture.
//
// Sentry behavior, keyed on SENTRY_DSN:
//   - SENTRY_DSN unset: no Sentry init (one info line). Zero egress, zero crash.
//   - SENTRY_DSN set: SIMPLE standalone Sentry.init() for runtime error capture
//     (errors + release health only; NO tracesSampleRate). Every event/
//     breadcrumb passes through the recursive PII/OS-path scrubber.
//
// DEFERRED on purpose:
//   - source-map upload (no @sentry/cli, no Dockerfile build-arg);
//   - the three-state standalone/coexist OTel integration. If both SENTRY_DSN
//     AND OTEL_EXPORTER_OTLP_ENDPOINT are set we log a loud warn and run Sentry
//     standalone anyway, rather than silently mis-wiring scope isolation.
//
// OTel behavior (unchanged):
//   - OTEL_EXPORTER_OTLP_ENDPOINT unset (or empty): the SDK is NOT initialized.
//     The process logs one INFO line and continues (local-dev path).
//   - If set, OTLP/http exporters push traces and metrics to that endpoint
//     (the SDK appends /v1/traces and /v1/metrics per the OTLP/HTTP spec).
//   - Logs are NOT shipped via OTel. The repo's CustomLogger writes JSON to
//     stdout and Promtail tails it into Loki.
//
// Resource attributes are intentionally low-cardinality (service.name,
// service.version, deployment.environment). NEVER add request- or user-scoped
// values here.

import * as Sentry from '@sentry/nestjs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { scrubEvent, scrubBreadcrumb } from './common/observability/sentry-scrub';
import { redactedIncomingSpanAttributes } from './common/observability/otel-http-redaction';
import { RedactingSpanExporter } from './common/observability/redacting-span-exporter';
import { SENTRY_UNHANDLED_REJECTION_MODE } from './common/observability/unhandled-rejection';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? '@repo/api';
// Release / service version. The runner launches `node apps/api/dist/main.js`
// directly (no npm/pnpm script), so npm_package_version is undefined at
// runtime. Prefer APP_VERSION (set as a Dockerfile build arg if you want a real
// release name); otherwise accept 0.0.0.
const APP_VERSION = process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.0.0';
const SERVICE_VERSION = APP_VERSION;
const DEPLOYMENT_ENV = process.env.NODE_ENV ?? 'development';

// Read both gates once at module load.
const SENTRY_DSN = process.env.SENTRY_DSN?.trim();
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

let sdk: NodeSDK | undefined;

function logLine(level: 'info' | 'warn', context: string, message: string): void {
  const fn = level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify({ timestamp: new Date().toISOString(), level, context, message }));
}

/**
 * Initialize Sentry for runtime error capture. Runs BEFORE the OTel NodeSDK is
 * built. No-ops with no DSN (zero egress, zero crash). Standalone only: the
 * OTel-coexist integration is deferred, so if an OTLP endpoint is also set we
 * warn rather than silently mis-wire error scope isolation.
 */
function initSentry(): void {
  if (!SENTRY_DSN) {
    logLine('info', 'Sentry', 'SENTRY_DSN not set, Sentry disabled (no-op)');
    return;
  }

  if (OTEL_ENDPOINT) {
    logLine(
      'warn',
      'Sentry',
      'SENTRY_DSN and OTEL_EXPORTER_OTLP_ENDPOINT are both set, but the Sentry/OTel coexist ' +
        'integration is not wired in this template. Running Sentry standalone; error scope ' +
        'isolation against the OTel NodeSDK is not guaranteed.',
    );
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || DEPLOYMENT_ENV,
    release: APP_VERSION,
    // The scrubbers are SDK-free (typed on a generic record) so they unit-test
    // in isolation; the SDK's ErrorEvent / Breadcrumb are objects without an
    // index signature, so bridge through `unknown` once at this boundary. The
    // scrub functions only read/rewrite a known subset of fields and return the
    // same reference, so the round-trip is type-sound.
    beforeSend: (event) =>
      scrubEvent(event as unknown as Record<string, unknown>) as typeof event | null,
    beforeBreadcrumb: (breadcrumb) =>
      scrubBreadcrumb(breadcrumb as unknown as Record<string, unknown>) as typeof breadcrumb | null,
    // Capture-only: without this pin the SDK default ("warn") would be the one
    // listener, logging and continuing, while a process with no DSN exits. The
    // exit decision belongs to main.ts's policy in both environments; see
    // common/observability/unhandled-rejection.ts.
    integrations: [
      Sentry.onUnhandledRejectionIntegration({ mode: SENTRY_UNHANDLED_REJECTION_MODE }),
    ],
    // NO tracesSampleRate: API is errors + release health only. Distributed
    // backend tracing stays OTel's job.
  });

  logLine('info', 'Sentry', 'Sentry initialized (standalone error capture)');
}

export function initOtel(): void {
  if (!OTEL_ENDPOINT) {
    // Stay quiet if the endpoint is unset, this is the default local-dev path.
    // We deliberately do NOT instantiate NodeSDK with a no-op exporter because
    // that still incurs the auto-instrumentation monkey-patch cost.
    logLine('info', 'OTel', 'OTEL_EXPORTER_OTLP_ENDPOINT not set, OTel SDK disabled (no-op)');
    return;
  }

  const protocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/protobuf';
  if (protocol !== 'http/protobuf') {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        context: 'OTel',
        message: `OTEL_EXPORTER_OTLP_PROTOCOL=${protocol} not supported; only http/protobuf is wired in this template. Falling back to http/protobuf.`,
      }),
    );
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    'deployment.environment': DEPLOYMENT_ENV,
  });

  // Every span is redacted on its way out, whichever instrumentation opened it:
  // the server span hook below reaches only the http server span, and the
  // nestjs-core and router spans record the raw URL too.
  const traceExporter = new RedactingSpanExporter(
    new OTLPTraceExporter({
      url: `${OTEL_ENDPOINT.replace(/\/+$/, '')}/v1/traces`,
    }),
  );
  const metricExporter = new OTLPMetricExporter({
    url: `${OTEL_ENDPOINT.replace(/\/+$/, '')}/v1/metrics`,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      // 60s default keeps OTLP push volume modest; prom-client /metrics is
      // still the primary metric surface for Prometheus pull.
      exportIntervalMillis: 60_000,
    }),
    instrumentations: [
      // http + pg + ioredis + nestjs-core auto-instrumentations.
      // fs is intentionally noisy; disable to keep the trace stream clean.
      // dns is similarly noisy on container DNS lookups.
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        // Incoming server spans record the request target verbatim, which
        // carries any path-segment credential and every batched tRPC
        // `input=`. See otel-http-redaction.ts. The exporter
        // applies the same rules to every span again; this hook stays so the
        // server span is clean even before export (span processors, samplers).
        '@opentelemetry/instrumentation-http': {
          startIncomingSpanHook: redactedIncomingSpanAttributes,
        },
        // instrumentation-router stays on. Its middleware spans leaked the
        // concrete path as `http.route`, but disabling one instrumentation per
        // leak is the pattern that let this one through: the exporter redacts
        // every span, so a leaking instrumentation is closed there. Whether its
        // per-middleware timing is worth the trace volume is a separate call.
      }),
      // Prisma is NOT bundled in auto-instrumentations-node, must add by hand.
      // Spans cover query lifecycle inside the engine.
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      context: 'OTel',
      message: 'OTel SDK initialized',
      data: {
        endpoint: OTEL_ENDPOINT,
        protocol: 'http/protobuf',
        serviceName: SERVICE_NAME,
        serviceVersion: SERVICE_VERSION,
        env: DEPLOYMENT_ENV,
      },
    }),
  );
}

/**
 * One graceful-shutdown path that flushes BOTH telemetry layers before the
 * single process exit, so neither in-flight OTel spans nor captured Sentry
 * events are dropped on SIGTERM/SIGINT. Registered only when at least one layer
 * is active, so a pure local-dev process (no DSN, no OTLP) keeps Nest's own
 * enableShutdownHooks() path untouched. A separate Sentry.close() handler in
 * main.ts would race this handler's process.exit, hence the consolidation here.
 */
function registerGracefulShutdown(): void {
  if (!SENTRY_DSN && !OTEL_ENDPOINT) return;

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // close() resolves even when Sentry is uninitialized, so it is safe
    // unconditionally; gate on the DSN anyway to avoid a needless 2s wait.
    void Promise.allSettled([
      sdk ? sdk.shutdown() : Promise.resolve(),
      SENTRY_DSN ? Sentry.close(2000) : Promise.resolve(),
    ])
      .catch((err: unknown) => {
        console.error('Telemetry shutdown error', err);
      })
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

// Order is mandatory: Sentry first (init before the NodeSDK is constructed),
// THEN OTel, THEN the consolidated shutdown that flushes both.
initSentry();
initOtel();
registerGracefulShutdown();
