# Observability Stack: LGTM Overlay

The `observability/` directory at the repo root is a Docker Compose **overlay** that adds a self-hosted Grafana LGTM stack (Loki + Grafana + Tempo + Prometheus) alongside the production services.

It is intentionally **not baked into `docker-compose.prod.yml`**. Bringing up observability is an explicit operator decision, not a side-effect of `docker compose up`.

---

## Table of Contents

1. [What's in the stack](#whats-in-the-stack)
2. [Local dev, quick start](#local-dev-quick-start)
3. [Production wiring](#production-wiring)
4. [Retention defaults](#retention-defaults)
5. [Disk-budget estimates](#disk-budget-estimates)
6. [Version pinning rationale](#version-pinning-rationale)
7. [Backup posture](#backup-posture)
8. [What's intentionally NOT here](#whats-intentionally-not-here)
9. [Sentry decision pointer](#sentry-decision-pointer)
10. [Tenant labels pointer](#tenant-labels-pointer)
11. [Dashboard catalog](#dashboard-catalog)
12. [Troubleshooting](#troubleshooting)

---

## What's in the stack

| Container           | Image                                           | Purpose                                                                                                 |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `prometheus`        | `prom/prometheus:v3.3.1`                        | Metrics store, scrapes API `/metrics`, postgres-exporter, redis-exporter, node-exporter, otel-collector |
| `loki`              | `grafana/loki:3.5.0`                            | Log aggregation, receives logs from Promtail (Docker stdout) and OTel Collector (OTLP logs, Slice D)    |
| `promtail`          | `grafana/promtail:3.5.0`                        | Log shipper, tails Docker container stdout/stderr via Docker socket, ships JSON-parsed lines to Loki    |
| `tempo`             | `grafana/tempo:2.7.2`                           | Distributed tracing, receives OTLP from otel-collector (Slice D will wire the API)                      |
| `otel-collector`    | `otel/opentelemetry-collector-contrib:0.125.0`  | OTLP on-ramp, accepts traces/metrics/logs from the API (Slice D), forwards to Tempo/Prometheus/Loki     |
| `grafana`           | `grafana/grafana:11.6.1`                        | Visualization, datasources and dashboards provisioned from Git                                          |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.17.1` | Exports Postgres metrics to Prometheus                                                                  |
| `redis-exporter`    | `oliver006/redis_exporter:v1.67.0`              | Exports Redis metrics to Prometheus                                                                     |
| `node-exporter`     | `prom/node-exporter:v1.9.1`                     | Host-level CPU/memory/disk/network metrics                                                              |

All services run in **single-binary mode**. No clustered/distributed modes are enabled, see [What's intentionally NOT here](#whats-intentionally-not-here).

---

## Local dev: quick start

### Prerequisites

- The prod stack is already up: `docker compose -f docker-compose.prod.yml up -d`
- `.env` contains the required obs env vars (copy from `.env.example`)

### Minimum required env vars

```sh
GRAFANA_ADMIN_PASSWORD=<something-strong>
METRICS_USER=metrics
METRICS_PASSWORD=<matches-METRICS_BASIC_AUTH-in-api-env>
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<your-postgres-password>
POSTGRES_DB=template
REDIS_PASSWORD=<your-redis-password>
```

The API's `METRICS_BASIC_AUTH` env var must equal `"${METRICS_USER}:${METRICS_PASSWORD}"`: Prometheus uses these two separately to construct Basic Auth headers when scraping `/metrics`.

### Bring up the overlay

```sh
docker compose -f docker-compose.prod.yml \
               -f observability/docker-compose.obs.yml \
               up -d
```

### Port mappings (local dev)

| Service    | Host port               | Notes                                      |
| ---------- | ----------------------- | ------------------------------------------ |
| Grafana    | `http://127.0.0.1:3001` | Login: `admin` / `$GRAFANA_ADMIN_PASSWORD` |
| OTLP gRPC  | `127.0.0.1:4317`        | For API OTLP export (Slice D)              |
| OTLP HTTP  | `127.0.0.1:4318`        | For web OTLP export (Slice D)              |
| Prometheus | internal only           | Access via Grafana datasource              |
| Loki       | internal only           | Access via Grafana datasource              |
| Tempo      | internal only           | Access via Grafana datasource              |

Prometheus, Loki, Tempo, and the exporters are not exposed on host ports, they are accessible only to other containers on the compose network and via Grafana.

### Verify health

```sh
# Grafana health
curl -s http://127.0.0.1:3001/api/health
# Expected: {"database":"ok","version":"11.x.x","commit":"..."}

# Check datasources (requires admin credentials)
curl -s -u admin:${GRAFANA_ADMIN_PASSWORD} \
     http://127.0.0.1:3001/api/datasources

# Verify api-overview dashboard loads
curl -s -u admin:${GRAFANA_ADMIN_PASSWORD} \
     http://127.0.0.1:3001/api/dashboards/uid/api-overview | jq '.dashboard.title'
```

---

## Production wiring

### Binding to loopback

All external ports in the overlay are bound to `127.0.0.1` by default. In `docker-compose.obs.yml`:

```yaml
grafana:
  ports:
    - '127.0.0.1:3001:3000' # loopback only
```

**Never expose Grafana directly on `0.0.0.0:3001`** in production: front it with a reverse proxy that terminates TLS (Traefik, Caddy, nginx, or your platform's proxy).

### Reverse proxy (Traefik example)

With Traefik, add labels to the `grafana` service (for example via `docker-compose.obs.yml` label overrides). Other proxies need the equivalent host rule, TLS and basic auth:

```yaml
grafana:
  labels:
    - 'traefik.enable=true'
    - 'traefik.http.routers.grafana.rule=Host(`grafana.yourdomain.com`)'
    - 'traefik.http.routers.grafana.entrypoints=websecure'
    - 'traefik.http.routers.grafana.tls=true'
    - 'traefik.http.routers.grafana.tls.certresolver=letsencrypt'
    - 'traefik.http.services.grafana.loadbalancer.server.port=3000'
    # Protect Grafana behind Traefik Basic Auth while you set up SSO
    - 'traefik.http.routers.grafana.middlewares=grafana-auth'
    - 'traefik.http.middlewares.grafana-auth.basicauth.users=admin:$$apr1$$...'
```

When Grafana is behind a proxy, also set `GF_SERVER_ROOT_URL` to the public URL. The api's own proxy settings (`TRUST_PROXY`) are covered in the deployment docs.

### Required env vars for production

Set these in your deployment `.env` or your platform's secret store:

```sh
# Already required by prod stack
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong>
POSTGRES_DB=template
REDIS_PASSWORD=<strong>

# New for the obs overlay
GRAFANA_ADMIN_PASSWORD=<strong, generate: openssl rand -hex 24>
METRICS_USER=metrics
METRICS_PASSWORD=<strong, generate: openssl rand -hex 16>

# Optional tuning (defaults shown)
LOKI_RETENTION_PERIOD=744h     # 31 days
TEMPO_RETENTION_HOURS=72       # 3 days
PROM_RETENTION_DAYS=15d
```

The API must also have `METRICS_BASIC_AUTH` set to `"${METRICS_USER}:${METRICS_PASSWORD}"`: this is the single-string format the NestJS `MetricsController` validates against.

### node-exporter (host metrics)

The `node-exporter` service uses `pid: host` and `network_mode: host` to read accurate host-level metrics. This usually works out of the box on a VM. On shared or managed container platforms you may need to disable node-exporter and remove its scrape job from `prometheus.yml` if host namespace access is restricted.

---

## Retention defaults

| Signal                 | Default retention | How to change                                           |
| ---------------------- | ----------------- | ------------------------------------------------------- |
| **Prometheus metrics** | 15 days           | Set `PROM_RETENTION_DAYS=30d` in `.env`                 |
| **Loki logs**          | 31 days (`744h`)  | Set `LOKI_RETENTION_PERIOD=336h` for 14d, `168h` for 7d |
| **Tempo traces**       | 72 hours (3 days) | Set `TEMPO_RETENTION_HOURS=168` for 7d                  |

Retention is deliberately short by default because observability data is ephemeral, it is for debugging and alerting, not compliance. See [Backup posture](#backup-posture).

For a compliance retention requirement (e.g. 7-year audit trail), use the `AuditLog` Postgres table, that is the source of truth. Do not extend Loki retention as a compliance substitute.

---

## Disk-budget estimates

The following estimates are sourced from Grafana Labs' published benchmarks and blog posts. They are rough guidance for capacity planning on a single host.

**These numbers assume:**

- Native sample rate (no downsampling)
- Default Prometheus 15-second scrape interval
- A single-replica API

| Signal                 | ~GB/day at 100 req/s | ~GB/day at 1,000 req/s | Notes                                                                                                                                                                                                                                  |
| ---------------------- | -------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prometheus metrics** | ~0.05 GB             | ~0.2 GB                | Scales with cardinality (label sets), not request volume directly. Estimate from [Grafana sizing guide](https://grafana.com/docs/grafana-cloud/cost-management-and-billing/understand-your-invoice/metrics-costs/).                    |
| **Loki logs**          | ~0.5–2 GB            | ~5–20 GB               | Highly dependent on log verbosity (`LOG_LEVEL=info` vs `debug`) and compression ratio. Structured JSON compresses well (~5–10x with Snappy). Estimate from [Loki sizing calculator](https://grafana.com/docs/loki/latest/setup/size/). |
| **Tempo traces**       | 0 (no traces yet)    | ~1–5 GB                | Depends on whether OTLP export is enabled and on the sampling rate. At 1% head-based sampling, Tempo overhead is negligible. Estimate from [Tempo storage docs](https://grafana.com/docs/tempo/latest/operations/backend_search/).     |

**Important caveat:** these estimates are based on published Grafana Labs documentation as of mid-2025 and general community benchmarks. Your actual disk usage will depend on log verbosity, number of services, custom metric cardinality, and trace sampling rate. Monitor `df -h` on the host after the first 24 hours and adjust retention accordingly.

**Recommended minimum free disk for obs stack:** 20 GB headroom on the volume hosting Docker volumes.

---

## Version pinning rationale

All images are pinned to specific minor versions (e.g. `grafana/loki:3.5.0`), not `:latest` or floating major tags (`:3`).

Reasons:

1. **Reproducibility**: a fresh deploy six months from now gets the same binaries you tested.
2. **Security audit trail**: `pnpm audit` / Dependabot equivalents for container images require known versions.
3. **Compatibility**: Promtail must match Loki's minor version; mismatches cause silent push failures.
4. **No `:latest`**: a floating tag turns an unrelated redeploy into an upgrade.

To upgrade: bump the version in `observability/docker-compose.obs.yml`, test locally with `docker compose ... config`, and commit the change.

---

## Backup posture

Observability data is **intentionally ephemeral**.

- **Dashboards** live in `observability/grafana/dashboards/*.json` (provisioned). Dashboard loss is fully recoverable from Git. Do not save dashboards only in Grafana's database, export and commit.
- **Metric data** (Prometheus) is stored in the `prom_data` Docker volume. Loss of this volume means loss of historical metric data, acceptable, as alerts fire on live data.
- **Log data** (Loki) is stored in `loki_data`. Loss means loss of queryable logs, acceptable for the same reason. The Docker `json-file` logs on the host are not affected.
- **Trace data** (Tempo) is stored in `tempo_data`. Loss means loss of traces, acceptable; traces are debugging aids, not source of truth.
- **No backup automation is provided for obs volumes.** If you require long-term metric/log retention for regulatory purposes, that is a separate pipeline (e.g. Prometheus remote-write to Thanos/Cortex, Loki S3 backend). For now, the `AuditLog` Postgres table is the compliance record.

---

## What's intentionally NOT here

These are deliberate scope decisions, not gaps:

1. **No ELK / OpenSearch**: Loki is the right choice at this scale. ELK is a maintenance trap on a single host.
2. **No multiple log shippers**: Promtail only. Adding Vector or Fluent Bit alongside Promtail creates duplicate log pipelines.
3. **No clustered/distributed modes**: Loki, Tempo, and Prometheus run in single-binary mode. No Loki ring, no distributed Tempo, no Mimir. Customers scaling to multiple API replicas will need to upgrade backend stores.
4. **No Sentry session replay**: deferred until SOC2 + GDPR posture is decided. See [Sentry decision pointer](#sentry-decision-pointer).
5. **No `apps/desktop` in this stack**: desktop crash dumps go directly to Sentry's minidump endpoint via `CRASH_REPORTER_URL`. That is configured separately in the desktop app, not here.
6. **No AuditLog → Loki mirror**: the Postgres `AuditLog` table is the compliance source of truth. Writing it to Loki creates a parallel store that can drift and is NOT a substitute.
7. **No high-cardinality Prom labels**: `userId`, `requestId`, `path`, `tenantId`, UUIDs are never used as Prometheus labels in this stack. They remain queryable as structured fields in log lines (via LogQL `| json`) and as span attributes in Tempo (via TraceQL).
8. **No `apps/api/logs/` file transport**: stdout + Promtail is the correct container pattern. File logging without rotation is a footgun.

---

## Sentry decision pointer

Error tracking is optional and off by default. The api and the web app ship Sentry SDK wiring that
activates only when a DSN is configured (`SENTRY_DSN` for the api, the matching `VITE_` key for the
web build), with PII scrubbing applied before anything leaves the process. Any Sentry-compatible
backend works:

- Sentry SaaS: lowest ops overhead, recurring cost
- Self-hosted GlitchTip: drop-in DSN swap, adds maintenance burden
- Grafana Faro (frontend) + traces/logs only: single stack, newer community

The docs site page `operations/observability` describes what is wired and how Sentry and OTLP export
interact. Without a DSN, 5xx errors are logged by `AllExceptionsFilter` and queryable in Loki
(`{compose_service="api"} | json | level="error"`), but there is no aggregated error-tracking UI
with grouping, assignees, or release tracking.

---

## Tenant labels pointer

The `tenant_id` Prometheus label is **deliberately absent** from this stack. The api resolves the
tenant per request and carries `tenantId` in the request context (AsyncLocalStorage), so it is
available to structured logs and spans, but a per-tenant Prometheus label is a cardinality bomb:
one label value per tenant means unbounded metric series growth.

If you need per-tenant metrics:

1. Surface `tenantId` as a structured log field (low-cost in Loki, queryable via LogQL).
2. Add it as a Prometheus label only with a known-tenant allowlist that bounds cardinality.
3. Build a tenant-errors dashboard on top of the log field first; it rarely needs metrics.

---

## Dashboard catalog

| UID            | File                | Description                                                                                                                                 |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-overview` | `api-overview.json` | Request rate, p50/p95/p99 latency by route, status-class distribution, error rate, event-loop lag, heap usage, web-vitals (LCP/FID/CLS) P75 |
| `postgres`     | `postgres.json`     | Connection pool, cache hit ratio, transaction rate, deadlocks, rows inserted/updated/deleted                                                |
| `redis`        | `redis.json`        | Ops/sec, hit/miss ratio, memory usage, connected clients, evictions, keyspace by DB                                                         |
| `bullmq`       | `bullmq.json`       | Placeholder, panels go live when Slice D adds queue-depth gauges to `MetricsModule`                                                         |

Dashboards are provisioned as read-only from Git. To edit a dashboard:

1. Make changes in the Grafana UI (temporarily set `allowUiUpdates: true` in `provisioning/dashboards/dashboards.yml`)
2. Export the JSON via Grafana → Dashboard → Share → Export
3. Commit the exported JSON back to `observability/grafana/dashboards/`
4. Revert `allowUiUpdates` to `false`

---

## Troubleshooting

**Prometheus can't scrape the API (`/metrics` returns 401`)**

Check that `METRICS_USER` and `METRICS_PASSWORD` match the `METRICS_BASIC_AUTH` value in the API's env:

```sh
# API env should have:
METRICS_BASIC_AUTH="${METRICS_USER}:${METRICS_PASSWORD}"
# e.g. METRICS_BASIC_AUTH="metrics:mysecretpassword"
```

**Promtail logs show "no such file or directory" for container log paths**

On some Linux distributions Docker stores container logs at `/var/lib/docker/containers/` only when using the `json-file` log driver (which is the default and what `docker-compose.prod.yml` enforces). Verify:

```sh
ls /var/lib/docker/containers/
```

If empty, check `docker info | grep "Logging Driver"`.

**Loki returns "entry too far behind" push errors**

The Promtail `positions.yaml` has stale positions. Remove the promtail_positions volume and restart:

```sh
docker compose -f docker-compose.prod.yml \
               -f observability/docker-compose.obs.yml \
               rm -f promtail
docker volume rm <project>_promtail_positions
docker compose -f docker-compose.prod.yml \
               -f observability/docker-compose.obs.yml \
               up -d promtail
```

**Grafana shows datasource as "red" / unable to connect**

Datasources use internal Docker service names (`http://prometheus:9090`, `http://loki:3100`, `http://tempo:3200`). These are only resolvable from within the Docker network. Grafana must be on the same network as Prometheus/Loki/Tempo, the overlay compose file handles this automatically by joining the prod stack's default network.

**node-exporter shows no data**

On managed container platforms or rootless Docker setups, `pid: host` and `network_mode: host` may be restricted. Disable node-exporter by commenting it out in `docker-compose.obs.yml` and removing the `node` scrape job from `prometheus.yml`.
