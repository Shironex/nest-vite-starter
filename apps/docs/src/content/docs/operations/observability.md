---
title: Observability
description: Sentry, OpenTelemetry, Prometheus, structured logging, correlation IDs, and health checks across api, web, and desktop.
sidebar:
  order: 5
---

This page documents what actually exists in the repository today: what is wired, what is optional, and what is deliberately left out.

## Summary of the stack

| Signal                                                 | Status                                           | Where                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Structured logging                                     | Implemented                                      | `packages/shared/src/logger/index.ts`, `apps/api/src/modules/logger/logger.service.ts` |
| Correlation IDs (request/trace/span/tenant)            | Implemented                                      | `apps/api/src/common/context/request-context.ts`                                       |
| Error tracking (Sentry)                                | Implemented, opt-in via env var                  | `apps/api/src/otel.ts`, `apps/web/src/lib/error-reporting.ts`                          |
| Distributed tracing (OpenTelemetry)                    | Implemented, opt-in via env var                  | `apps/api/src/otel.ts`                                                                 |
| Metrics (Prometheus)                                   | Implemented                                      | `apps/api/src/modules/metrics/`                                                        |
| Frontend web-vitals                                    | Implemented                                      | `apps/web/src/main.tsx`, `apps/api/src/modules/metrics/vitals.controller.ts`           |
| Health checks (liveness/readiness)                     | Implemented, split                               | `apps/api/src/modules/health/health.controller.ts`                                     |
| Self-hosted LGTM stack (Grafana/Loki/Tempo/Prometheus) | Implemented, optional overlay                    | `observability/`                                                                       |
| Electron crash reporting                               | Implemented, upload target unset by default      | `apps/desktop/src/main/index.ts`                                                       |
| Queue observability (BullMQ)                           | Implemented (metrics + health), no Bull Board UI | `apps/api/src/common/queue/`, `apps/api/src/modules/health/indicators/queue.health.ts` |

## Sentry

### API (`apps/api`)

Sentry is initialized in `apps/api/src/otel.ts` via `@sentry/nestjs`, imported as the very first line of `apps/api/src/main.ts` (before any `@nestjs/*` import), because the OpenTelemetry auto-instrumentations need to monkey-patch `http`/`pg`/`ioredis`/`nestjs-core`/`prisma` before Nest's own modules load.

Behavior is entirely keyed on the `SENTRY_DSN` env var:

- Unset (default): `Sentry.init` is never called. One informational log line is emitted, zero egress, zero crash risk. This is the default local-dev and CI path.
- Set: `Sentry.init` runs with `sendDefaultPii: false`, `environment` from `SENTRY_ENVIRONMENT` (falls back to `NODE_ENV`), `release` from `APP_VERSION`, and **no `tracesSampleRate`**: the API's Sentry integration is errors + release health only. Distributed tracing is OTel's job, not Sentry's, in SaaS Starter.

Every event and breadcrumb passes through `scrubEvent`/`scrubBreadcrumb` in `apps/api/src/common/observability/sentry-scrub.ts` before being sent, which redacts any key matching the shared `SENSITIVE_KEY_PATTERNS` list (see [Logging](#logging-and-redaction) below) in `event.extra`, `event.contexts`, and `event.request`.

`AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts`) calls `Sentry.captureException` **only for 5xx responses**: 4xx client errors (validation, bad auth, missing route) are not sent, to avoid drowning the Sentry quota in noise.

Sentry and OpenTelemetry can both be configured, but the two are **not** wired to coexist: if `SENTRY_DSN` and `OTEL_EXPORTER_OTLP_ENDPOINT` are both set, `otel.ts` logs a loud warning and runs Sentry standalone anyway ("scope isolation against the OTel NodeSDK is not guaranteed"). This is a deliberate, documented deferral, not a bug, see the comment block at the top of `apps/api/src/otel.ts`.

Deferred on purpose: source-map upload (no `@sentry/cli` step, no Dockerfile build-arg for it) and the three-state standalone/coexist OTel integration mentioned above.

### Web (`apps/web`)

Frontend error reporting is a facade over `@sentry/react` in `apps/web/src/lib/error-reporting.ts`, **opt-in and off by default**:

- Enabled only when `VITE_SENTRY_DSN` is a non-empty string **and** the app is not running inside the Electron renderer (`window.electronAPI !== undefined` gates it off). The packaged desktop renderer loads the same web bundle over `app://`, and its CSP `connect-src` is built from `API_URL` only, so Sentry ingest would be blocked there anyway; desktop crash reporting is handled separately via Electron's native `crashReporter` (see below), not `@sentry/react`.
- The SDK is loaded via a dynamic `import('./error-reporting.sentry')` inside `initErrorReporting()`, so it never lands in the entry chunk. `error-reporting.sentry.ts` is a thin bridge that re-exports only `init` and `captureException` from `@sentry/react`: a direct dynamic namespace import would pull in session replay, feedback widgets, and tracing integrations and roughly triple the lazy chunk.
- Config: `tracesSampleRate: 0` (errors only, no performance tracing), `sendDefaultPii: false`, `beforeSend`/`beforeBreadcrumb` scrubbers shared in spirit with the API's (same `SENSITIVE_KEY_PATTERNS` denylist from `@repo/shared/logger`).
- `captureException(error, context)` is safe to call at any point in the app lifecycle: before init it queues behind the in-flight init promise, and if reporting is disabled it silently no-ops (with a `console.debug` fallback in `DEV`).

This is **not** a runtime user-consent banner, there is no cookie-consent gate in the web app that toggles Sentry on/off per-user. "Opt-in" here means a build/deploy-time decision: whoever deploys the web app either sets `VITE_SENTRY_DSN` or leaves it empty. If your deployment needs consent-gated analytics/error-reporting per visitor, that gate does not currently exist and would need to be added around `initErrorReporting()`.

### Desktop (`apps/desktop`)

`apps/desktop/src/main/index.ts` calls Electron's native `crashReporter.start({ submitURL: process.env['CRASH_REPORTER_URL'] ?? '', uploadToServer: Boolean(process.env['CRASH_REPORTER_URL']) })`. With `CRASH_REPORTER_URL` unset (the default, see `.env.example`), crash dumps are collected locally but never uploaded. The comment in that file notes the URL is empty "for now, when Sentry/GlitchTip lands ... point this at `/api/14/minidump/?sentry_key=...`". No `@sentry/electron` package is installed; this is native Electron `crashReporter` only.

## OpenTelemetry

`apps/api/src/otel.ts` also owns the OpenTelemetry `NodeSDK` setup, gated on `OTEL_EXPORTER_OTLP_ENDPOINT`:

- Unset (default): the SDK is never constructed (not even with a no-op exporter, since that would still incur the auto-instrumentation monkey-patch cost). One info log line, otherwise silent.
- Set: builds an OTLP/HTTP (`http/protobuf` only, other protocol values fall back with a warning) trace exporter and metric exporter pointed at `<endpoint>/v1/traces` and `<endpoint>/v1/metrics`. Instrumentation: `getNodeAutoInstrumentations()` (covers `http`, `pg`, `ioredis`, `@nestjs/core`, etc., with `fs` and `dns` instrumentations explicitly disabled, too noisy) plus `PrismaInstrumentation` added by hand (Prisma is not in the auto-instrumentations bundle).
- Span redaction: URLs carry credentials (the OAuth callback's `code`/`state`, a batched tRPC GET's `input=`, and any ticket or token carried as a path segment). The trace exporter is wrapped in `RedactingSpanExporter` (`apps/api/src/common/observability/redacting-span-exporter.ts`), which rewrites every string on every span before export (attributes, span name, status message, event and link attributes): a credential path tail becomes `[REDACTED]` and any query string becomes `?[REDACTED]`. It covers spans from every instrumentation, including the nestjs-core `url.full` and the router `http.route` that leaked before issue 282. The `startIncomingSpanHook` on the http server span applies the same rules (`redactUrlText` in `otel-http-redaction.ts`).
- Resource attributes are deliberately low-cardinality: `service.name`, `service.version`, `deployment.environment`. Request- or user-scoped values are never added as resource attributes.
- A single consolidated `registerGracefulShutdown()` flushes both the OTel SDK and Sentry on `SIGTERM`/`SIGINT` before `process.exit(0)`, so in-flight spans and captured events are not dropped on container stop.

Traces are the correlation mechanism between the API's structured logs and any tracing backend: when an OTel span is active, `apps/api/src/modules/logger/logger.service.ts` reads the active span's `traceId`/`spanId` (via `trace.getActiveSpan()`) and stamps them onto every structured log line, falling back to whatever was captured on the AsyncLocalStorage request-context store if there is no active span (see [Correlation IDs](#correlation-ids)).

## Prometheus metrics

`GET /metrics` (`apps/api/src/modules/metrics/metrics.controller.ts`) exposes the global `prom-client` registry. It is protected by HTTP Basic Auth driven by the `METRICS_BASIC_AUTH` env var (`user:password` format), compared with `crypto.timingSafeEqual` so the endpoint cannot be used as a timing oracle. In production the Joi env schema **requires** `METRICS_BASIC_AUTH` (min length 3), the endpoint fails closed at boot rather than shipping an open scrape target; in dev/test it is optional and auth is skipped when unset.

`MetricsService` (`OnApplicationBootstrap`) registers Node default metrics (`collectDefaultMetrics`) with an `api_` prefix and `service`/`version` labels, wired into the NestJS lifecycle rather than at module-import time so parallel Jest workers don't hit prom-client's "double registration" error.

Custom metrics live in `apps/api/src/modules/metrics/metrics.registry.ts` as module-level singletons (again, to avoid double-registration across Jest workers):

- `http_request_duration_seconds`: histogram, labeled `method`/`route`/`status_class`.
- `trpc_procedure_duration_seconds`: histogram, labeled `procedure`/`type`/`ok`. Because a tRPC batch is one HTTP request, this is the metric to read for per-procedure throughput/latency, not the HTTP histogram.
- `auth_outcomes_total` - counter, labeled `flow` (`login`, `twofa_challenge`, `oauth_callback`, `password_reset`, `session_mint`) and `outcome`. Every authentication outcome used to exist only as an `AuditLog` row, so lockout rate, 2FA failure rate, reset completions and session-epoch fence refusals were queryable only by SQL over a table whose writes are best effort. `trpc_procedure_duration_seconds{procedure="auth.login",ok="false"}` is not a substitute: it also counts 500s. Both label sets are closed and written at the call site, never derived from input. `userId` is on the accompanying log line, never a label.
- `token_cleanup_deleted_total`, `audit_write_failures_total`, `audit_retention_deleted_total`, `mail_send_failures_total` (labeled `template`), `storage_orphan_cleanup_failures_total`, `notification_retention_deleted_total`, `user_purge_deleted_total`, `user_purge_failures_total`.

Label-cardinality rule enforced throughout: **no** `userId`, `requestId`, raw path, raw status code, or UUIDs as label values, only bounded sets (`route` = matched Express pattern, `status_class` = `2xx`/`3xx`/`4xx`/`5xx`, etc). This same rule blocks adding `tenant_id` as a label until tenants are a bounded, known set (see the LGTM stack notes below).

Prometheus alert rules (used by the optional LGTM overlay, `observability/prometheus/rules/api.rules.yml`) include: `ApiHighErrorRate` (5xx rate > 5% for 2m, critical), `ApiHighP99Latency` (tRPC p99 > 2s for 5m, warning), `ApiEventLoopLag` (> 100ms, warning), `ApiHeapNearLimit` (> 80% of heap, warning), `AuditWriteFailures` (any increase, critical, audit writes are swallowed by design so this is the only signal that the audit trail silently lost a row), `MailSendFailures` (any increase, critical), `EmailQueueDLQNonEmpty` (warning), `TargetDown` (`up == 0` for 2m, critical), and `PostgresConnectionPoolExhausted` (> 85% for 5m, critical).

## Web-vitals

The web app reports Core Web Vitals via `apps/web/src/main.tsx`, POSTing to `GET/POST /api/vitals` handled by `apps/api/src/modules/metrics/vitals.controller.ts`. The beacon uses `navigator.sendBeacon` with a `text/plain` body (not JSON) specifically so the request stays CORS-simple and never needs a preflight, this matters for the packaged Electron `app://` origin, which cannot perform a preflight. `apps/api/src/main.ts` registers a body-parser for `text/plain` and exempts `/api/vitals` from CSRF (a beacon fired before any session exists cannot carry a CSRF token) and from the pre-session `csrf-sid` cookie assignment (to avoid a cookie race with `GET /api/csrf-token`).

## The self-hosted LGTM stack (optional overlay)

`observability/` at the repo root is a **separate, optional** Docker Compose overlay (`observability/docker-compose.obs.yml`) layered on top of `docker-compose.prod.yml`. It is intentionally not baked into the prod compose file, bringing it up is an explicit operator decision. Full operating instructions live in `docs/observability/README.md`; summary:

- **Components**: Prometheus (`prom/prometheus:v3.3.1`, scrapes the API `/metrics` plus postgres-exporter/redis-exporter/node-exporter/otel-collector), Loki + Promtail (log aggregation, tails Docker container stdout), Tempo (trace storage, receives OTLP from otel-collector), an OTel Collector (OTLP on-ramp), and Grafana (dashboards, provisioned from Git). All run in single-binary/non-clustered mode.
- **Bring-up**: `docker compose -f docker-compose.prod.yml -f observability/docker-compose.obs.yml up -d`. Requires `GRAFANA_ADMIN_PASSWORD`, `METRICS_USER`/`METRICS_PASSWORD` (must match the API's `METRICS_BASIC_AUTH`), plus the existing Postgres/Redis credentials.
- **Ports**: Grafana on `127.0.0.1:3001` (loopback only, never expose directly, front it with a reverse proxy), OTLP gRPC/HTTP on `127.0.0.1:4317`/`4318`. Prometheus/Loki/Tempo are internal-only, reachable through Grafana.
- **Retention**: Prometheus 15 days, Loki 31 days (744h), Tempo 72 hours by default, all overridable via env vars. Retention is deliberately short, this data is for debugging/alerting, not compliance. The `AuditLog` Postgres table is the compliance source of truth; do not extend Loki retention as a substitute.
- **Dashboards**: `api-overview` (request rate, p50/p95/p99 latency by route, error rate, event-loop lag, heap, web-vitals P75), `postgres`, `redis`, and a `bullmq` placeholder whose panels go live once queue-depth gauges are added to `MetricsModule`.
- **Deliberately absent** (documented, not oversights): no ELK/OpenSearch, no second log shipper alongside Promtail, no clustered/distributed Loki/Tempo/Prometheus modes, no Sentry session replay, no `apps/desktop` in this stack (desktop crash dumps go straight to Sentry's minidump endpoint, configured via `CRASH_REPORTER_URL`, not through this overlay), no `AuditLog` → Loki mirror, and no high-cardinality labels (`userId`, `requestId`, `tenantId`, UUIDs stay in log lines/span attributes, never Prometheus labels).
- **Tenant labels**: `tenant_id` is deliberately absent as both a structured log field and a Prometheus label until the tenancy model bounds the cardinality (adding it today would be an unbounded metric-series growth risk). See "Tenant labels pointer" in `docs/observability/README.md`.

## Logging and redaction

`packages/shared/src/logger/index.ts` is a universal logger (works in the NestJS API, the React frontend, and the Electron main process) exported as `createLogger(context, options)`. The API wraps it in `CustomLogger` (`apps/api/src/modules/logger/logger.service.ts`), which implements Nest's `LoggerService` interface and is installed via `app.useLogger()` in `main.ts`: so even Nest's own bootstrap/framework log lines flow through the structured logger and its redaction pipeline (this includes `bufferLogs: true` in `NestFactory.create`, which buffers logs emitted before the DI container exists and flushes them through `CustomLogger` once it's available).

Format: pretty ANSI-colored text in development, structured NDJSON in production (`structured: isProduction`). Every structured line includes `timestamp`, `level`, `context`, `message`, and, when available, `requestId`, `traceId`, `spanId`.

Redaction: `SENSITIVE_KEY_PATTERNS` (in `packages/shared/src/logger/index.ts`) is a single, shared denylist of substrings matched case-insensitively against object keys before they're logged: `password`, `passwd`, `secret`, `token`, `authorization`, `cookie`, `csrf`, `apikey`/`api_key`/`api-key`, `ssn`, `card`, `cvv`, `cvc`, `email`, `phone`, `sessionid`/`session_id`/`sid`, `userid`/`user_id`, `body`, `notes`, `content`, `encryptionkey`/`encryption_key`. `redactSensitive()` walks any value recursively (arrays, nested objects, depth-capped at 6 to avoid stack blowouts on large request objects) and replaces matching keys' values with `[REDACTED]`. This same list feeds both the structured-log redactor and the API's Sentry scrubber (`sentry-scrub.ts`) and the web's Sentry scrubber (`error-reporting.ts`): one source of truth.

## Correlation IDs

`apps/api/src/common/context/request-context.ts` defines an `AsyncLocalStorage<IRequestContext>` store (`requestContext`) carrying `requestId`, `userId`, `ip`, `userAgent`, `method`, `path`, `traceId`/`spanId` (W3C trace/span id when an OTel span is active), and `tenantId`/`workspaceId` (tenancy scope, `workspaceId` is reserved, not yet enforced). Helper accessors: `getRequestContext()`, `getRequestId()` (falls back to the literal string `'no-context'` outside a request), `getTraceId()`, `getSpanId()`, `getTenantId()`, `getWorkspaceId()`.

Propagation beyond plain HTTP requests:

- **Prisma slow-query logging**: `apps/api/src/main.ts` calls `dbModule.setRequestContextResolver(...)` (a dynamic ESM import of `@repo/database`, since that package is ESM-only and the API compiles to CJS) so slow-query log lines carry `requestId`/`userId`/`traceId`/`spanId` even though Prisma itself has no notion of the ALS store.
- **BullMQ jobs**: `apps/api/src/common/queue/job-context.ts` and `traced-worker.host.ts` re-enter the request context inside workers so job processing logs correlate back to the request/action that enqueued them.
- **WebSocket/Socket.IO**: socket handlers run inside an ALS request context using synthetic `ws-<socket.id>` request ids, so socket events never log with `no-context`.

## Health endpoints

`apps/api/src/modules/health/health.controller.ts` exposes three endpoints with distinct semantics (orchestrators need a liveness/readiness split, not a single `/health`):

- `GET /health/live`: trivial `{ status: 'ok' }`. Never depends on external services. An orchestrator restarts the container if this fails.
- `GET /health/ready`: checks DB (`SELECT 1`), Redis (`PING` + latency), and heap (150 MB threshold via `MemoryHealthIndicator`). A failure here means "remove from load-balancer pool," not "restart", a 30-second Redis blip should not kill the container. The queue indicator is deliberately **excluded** here: a backlog of non-critical mail must not depool a healthy node.
- `GET /health`: the same three checks plus the queue indicator (`QueueHealthIndicator`). This is the dashboards/alerting view, not the load-balancer probe.

`docker-compose.prod.yml` and `apps/api/Dockerfile` both use `GET /health` for their container healthchecks (via `wget --spider`); the `test-e2e` CI job's "Start API" step specifically asserts `GET /health/ready` after booting the real built artifact.

## Known gaps (documented, not silently missing)

- **Sentry/OTel coexistence**: both can be configured, but SaaS Starter runs them as mutually exclusive in practice (a loud warning if both DSN and OTLP endpoint are set), see above.
- **No source-map upload** for API or web Sentry events yet (a deliberate deferral, see above).
- **No Bull Board / queue admin UI**: queue health and metrics exist (`QueueHealthIndicator`, queue-depth-adjacent counters), but there is no `/admin/queues`-style UI for support staff to inspect stuck jobs. The `bullmq.json` Grafana dashboard is a placeholder pending queue-depth gauges.
- **No user-consent gate for Sentry** on the web app, enabling/disabling is a deploy-time env var, not a per-visitor runtime choice.
- **Desktop crash uploads are off by default**: `CRASH_REPORTER_URL` ships empty; crash dumps are captured locally only until an upload endpoint (Sentry minidump or otherwise) is configured.
- **Session replay**: not implemented anywhere, deliberately deferred pending SOC2/GDPR posture per `docs/observability/README.md`.
