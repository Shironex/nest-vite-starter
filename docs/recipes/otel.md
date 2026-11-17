# Recipe: OpenTelemetry tracing

**When you need it:** you want distributed traces (api, database, Redis, outgoing HTTP) in an
OTLP backend. The starter ships structured logs with a request id and optional Sentry, and no
tracing.

## Shape of the change

- **Bootstrap order.** The SDK must start before anything it patches is imported. The api already
  has the right seam: `apps/api/src/instrument.ts` is the first import of `main.ts` and is where
  Sentry initialises. Add the Node SDK there (`@opentelemetry/sdk-node` plus the auto
  instrumentations you want: http, express, pg, ioredis), gated on a new env key such as
  `OTEL_EXPORTER_OTLP_ENDPOINT`, so with it empty the SDK never starts and nothing leaves the
  process, as with Sentry.
- **Sentry overlap.** Sentry v8 and later already runs its own OpenTelemetry setup. Pick one owner
  for the tracer provider: either let Sentry own it and send traces to Sentry, or run your own SDK
  and configure Sentry to use it. Running two providers loses spans.
- **Correlation.** `RequestContext` (AsyncLocalStorage) already carries a `traceId`, and the
  database client takes a request context resolver in `main.ts`. Feed the active span's trace id
  into that field so logs and traces join on one id.
- **Worker.** `src/worker.ts` is a second entry point: import the same instrumentation first, or the
  queue consumers produce no spans. BullMQ jobs do not carry context by themselves, so add the
  trace headers to the job payload when you enqueue.
- **Web.** Browser tracing is a separate decision with a CSP cost (`connect-src`) and a privacy
  cost. Leave it off unless you need it.

## Pitfalls

- Auto-instrumentation of `pg` records statements: turn off statement capture or scrub it, since
  values can be PII.
- Sample in production. A trace per request is rarely worth the egress and cost.
- The eslint rule against `process.env` outside config is why `instrument.ts` is allowlisted:
  keep new env reads there or in `config/env.ts`.
