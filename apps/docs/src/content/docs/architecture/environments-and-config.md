---
title: Environments and Configuration
description: Env-var validation, .env layout, Docker/compose files, CI pipelines, and deployment notes (reverse proxy, S3) as implemented in this repo.
sidebar:
  order: 5
---

## Env-var validation

The API validates every environment variable at boot through a Joi schema: `apps/api/src/config/configuration.config.ts`'s `validationSchema`, wired into `ConfigModule.forRoot({ isGlobal: true, validationSchema, envFilePath: '.env' })` in `apps/api/src/app.module.ts`. `ConfigModule` is global, so `ConfigService` is injectable anywhere without re-importing the module. A missing or malformed required variable makes the API refuse to boot rather than run in a partially-configured state (fail-closed). This is intentional for anything security-relevant. `TURNSTILE_SECRET_KEY`, `CSRF_SECRET`, `ENCRYPTION_KEY`, and (in production only, via a Joi `.when('NODE_ENV', ...)` conditional) `METRICS_BASIC_AUTH` all have no default and are `required()`.

Selected validation details worth knowing when adding a new env var:

- `DATABASE_URL` / `REDIS_URL` are required URIs, no defaults: both apps refuse to start without a real connection string.
- `ENCRYPTION_KEY` must match `^(?:[A-Za-z0-9+/]{43}=|[0-9a-fA-F]{64})$` (base64-32 or hex-64, i.e. exactly 32 raw bytes): `EncryptionService` re-validates length/entropy again at its own construction, so a bad key fails twice, close to the point of use.
- `METRICS_BASIC_AUTH` is optional in dev/test, required in production: the `/metrics` endpoint fails closed rather than shipping an unauthenticated scrape target.
- `TRUST_PROXY` defaults to `'loopback'`, which is correct for a reverse proxy (Traefik, Caddy, nginx) on the same host; a multi-hop proxy chain (e.g. a CDN in front of the proxy) needs a numeric hop-count or explicit IP list instead (see the Express "trust proxy" docs referenced in the comment).
- `OTEL_EXPORTER_OTLP_ENDPOINT` and `SENTRY_DSN` are both optional strings with no default: leaving them empty disables OpenTelemetry / Sentry entirely (zero egress), which is the default local-dev path. See `apps/api/src/otel.ts`.

`apps/web` does not run its own Joi/zod validation pass over `import.meta.env`: Vite's built-in `VITE_`-prefix convention is the only gate (see below).

## `.env` layout

There is a **single root `.env.example`** (`/.env.example`) that both apps read from: both NestJS's `ConfigModule` and Vite's built-in dotenv loader point at the same file, per the file's own header comment. There is intentionally no separate `apps/api/.env.example`; keeping one file avoids the two-files-disagreeing failure mode.

Sections in `.env.example`, in order:

1. **Server**: `PORT`, `NODE_ENV`, `LOG_LEVEL`, `TRUST_PROXY`, `CORS_ORIGINS`.
2. **Database**: `DATABASE_URL`, `DB_POOL_MAX` and friends (see `data-layer.md`), plus retention windows that are really app config but live here: `AUDIT_LOG_RETENTION_DAYS`, `NOTIFICATION_RETENTION_DAYS`, `USER_PURGE_GRACE_DAYS`.
3. **Redis**: `REDIS_URL`, `REDIS_PASSWORD` (only consumed by `docker-compose.prod.yml`).
4. **App**: `APP_NAME`, `APP_URL`, `APP_TIME_ZONE` (the IANA zone the api does calendar-date math in and runs its daily `@Cron` sweeps in; `UTC` by default, validated by Joi against what `Intl` accepts, and read at module load by `apps/api/src/common/clock/app-calendar.ts` because the `@Cron` decorators need it before `ConfigService` exists). The display locale is not an env key: see "Language, locale and time zone" in `frontend/web-architecture.md`.
5. **SMTP**: `EMAIL_PROVIDER` (`smtp` default, or `resend` as a scaffolded-but-unimplemented alternative provider), `SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM`.
6. **Cloudflare Turnstile**: `TURNSTILE_SECRET_KEY` (dev uses Cloudflare's public always-pass test key `1x0000000000000000000000000000000AA`; production must replace it, and Joi has no default so a missing prod value fails closed).
7. **CSRF**: `CSRF_SECRET` (generate via `openssl rand -hex 32` for real environments).
8. **Encryption at rest**: `ENCRYPTION_KEY` (`EncryptionService`, AES-256-GCM), reversible and rotatable per value.
9. **S3 / object storage**: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Dev points at the bundled `s3rver` container (`S3RVER`/`S3RVER` credentials); production needs a real S3-compatible endpoint.
10. **Admin seed**: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, consumed only by `pnpm --filter @repo/database db:seed`, which refuses to run against `NODE_ENV=production` unless `ALLOW_PRODUCTION_SEED=true`.
11. **Postgres/Redis credentials for `docker-compose.prod.yml`**: `POSTGRES_USER`/`PASSWORD`/`DB`.
12. **Frontend (`VITE_`-prefixed)**: `VITE_TURNSTILE_SITE_KEY` (public counterpart of the secret key above), `VITE_SENTRY_DSN`. Both are **build arguments**, not runtime env: Vite inlines them into the bundle, `apps/web/Dockerfile` declares them as `ARG`/`ENV` in the builder stage and `turbo.json`'s `@repo/web#build.env` lists both, so they also take part in the build cache key. Setting them on the running web container does nothing. Note there is **no `VITE_API_URL`**: the SPA talks to the API via relative URLs (the platform's reverse proxy routes `/trpc`, `/api`, `/socket.io` to the API service: see `apps/web/nginx.conf`'s header comment), and the packaged Electron build instead receives the API URL over IPC from the main process, not via a baked-in Vite env var.
13. **Desktop (Electron main process)**: `API_URL` (defaults to `http://localhost:3000`), `CRASH_REPORTER_URL`.
14. **Observability stack** (`observability/docker-compose.obs.yml`, an optional overlay: see below): `GRAFANA_ADMIN_PASSWORD`, `METRICS_USER`/`METRICS_PASSWORD` (which together must form `METRICS_BASIC_AUTH`), `LOKI_RETENTION_PERIOD`, `TEMPO_RETENTION_HOURS`, `PROM_RETENTION_DAYS`.
15. **OpenTelemetry**: `OTEL_EXPORTER_OTLP_ENDPOINT` (empty disables the SDK), `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_SERVICE_NAME`.
16. **Sentry (API)**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `APP_VERSION` (the API runner launches `dist/src/main.js` directly, so `npm_package_version` isn't available at runtime: `APP_VERSION` must be set explicitly, e.g. as a Docker build arg, to get a real Sentry release name).

A companion `.secrets.example` at the repo root is unrelated to application secrets: it documents `.secrets` (gitignored), the file `act` auto-loads for local CI runs, and its only real entry is `TURBO_TOKEN` for Turbo remote caching. The throwaway values `ci.yml` sets inline per step (`ENCRYPTION_KEY`, `CSRF_SECRET`, `S3_*`, `TURNSTILE_*`) are explicitly called out in that file as not belonging there.

## Docker

### Local development: `docker-compose.yml`

Brings up only the stateful dependencies the apps talk to in dev: the apps themselves run via `pnpm dev`, not in containers:

- `postgres` (17-alpine), `redis` (7-alpine), both with healthchecks and named volumes.
- `mailpit`: a local SMTP catcher (SMTP on `1025`, web UI on `8025`).
- `s3` (`ghcr.io/clockwisesoftware/s3rver`): an S3-compatible server for local uploads, bucket `saas-starter-uploads`, matching `.env.example`'s `S3_*` dev defaults.

### Production: `docker-compose.prod.yml`

A full stack: a one-shot `migrate` service (`restart: 'no'`, runs `prisma migrate deploy` and must complete successfully before `api` starts: see the `depends_on: migrate: condition: service_completed_successfully` on the `api` service), `api`, `web`, `postgres`, `redis`. Notable hardening already in place:

- `postgres`/`redis` both require a real password via Compose's `${VAR:?error message}` syntax (fails fast if unset) rather than defaulting to something insecure.
- `redis` runs with `--appendonly yes` for AOF persistence, so session/BullMQ state survives a container restart.
- `api` and `web` both have `healthcheck:` blocks (`wget --spider` against `/health` and `/healthz` respectively) and `deploy.resources.limits`/`reservations` for memory.
- `api` is published only on `127.0.0.1:3000:3000`: it is not directly internet-reachable; a reverse proxy on the host terminates TLS and forwards to it.
- Logging uses the `json-file` driver with explicit `max-size`/`max-file` rotation on `api` and `web`.

### `apps/api/Dockerfile` (4 stages)

`deps` (installs with a pnpm store cache mount) -> `builder` (`prisma generate` + `turbo build --filter=@repo/api`) -> `migrate` (a minimal stage that only needs the Prisma schema/generated client + `node_modules`, entrypoint `prisma migrate deploy`, runs as `USER node`) -> `runner` (copies only the built `dist/` + production `node_modules` for `@repo/api`, `@repo/database`, `@repo/shared`, `@repo/email`; runs as `USER node`; `tini` as PID 1 for correct signal handling; a Docker-native `HEALTHCHECK` hitting `/health`).

### `apps/web/Dockerfile` (2 stages)

`builder` (installs, runs `pnpm --filter @repo/api generate:trpc` so the SPA can type-check against `AppRouter`, then `turbo build --filter=@repo/web`) -> `runner` on `nginxinc/nginx-unprivileged:1.29-alpine` (binds `8080`, non-root by default since the image itself runs as UID 101). `apps/web/nginx.conf` sets a full security-header set (CSP, HSTS, X-Frame-Options, Permissions-Policy, COOP/CORP), gzip, a `/healthz` endpoint for the platform healthcheck, SPA `try_files` fallback to `index.html`, and long-cache immutable headers under `/assets`. Its header comment states the deployment model explicitly: **this image serves the SPA only**: routing `/trpc`, `/api`, and `/socket.io` to the `api` service is the reverse proxy's job (Traefik, Caddy, nginx or a platform router), not this nginx config.

## CI/CD (`.github/workflows/`)

### `ci.yml`

Triggers on `push`/`pull_request` to `main` and `workflow_dispatch`, with `concurrency: cancel-in-progress` per ref. Dependabot pull requests run the same jobs as any other pull request. `TURBO_AFFECTED` is set to `--affected` only on `pull_request` events (compared against `github.event.pull_request.base.sha`), so pushes to `main` always run the full graph while PRs scope Turbo tasks to what changed: jobs still always run (so required status checks stay green), they just no-op the expensive work when nothing affected is present. Jobs:

- **`quality`**: install, `build:packages`, `turbo lint`/`check-types` (both `$TURBO_AFFECTED`-scoped), `pnpm lint:meta`, `pnpm check:lint-meta-docs`, `knip` for both `@repo/api` and `@repo/web`, and the eslint-plugin's own test suite.
- **`audit`**: `pnpm audit --prod --audit-level=high`.
- **`build`**: `turbo build` across the whole graph (needs `quality`).
- **`test-api`**: spins up real `postgres:17-alpine` + `redis:7-alpine` service containers, applies migrations (`db:migrate:deploy`), runs the two Prisma drift gates described in `data-layer.md` (Gate A: `db:migrate:status`; Gate B: `db:migrate:check`), then `pnpm --filter @repo/api test:cov:check` (Jest with a coverage-ratchet check via `scripts/check-coverage.mjs`).
- **`test-web`**: `pnpm --filter @repo/web test:cov:check` (Vitest + coverage ratchet), then builds the web app through `turbo build --filter=@repo/web` (so the `generate:trpc` dependency fires) and runs `size:check` (bundle-size budget via `size-limit`) and `lighthouse` (Lighthouse CI; skipped under `act`/local runs where a real Chrome isn't available, per the step's own comment).
- **`test-e2e`**: migrates + seeds a real admin user (credentials must match what `apps/web/e2e/auth-login.spec.ts` expects), builds `@repo/api` and builds `@repo/web` with `vite build --base=/` (not the default `./` used for the Electron shell: an absolute base is required so `vite preview`'s SPA fallback resolves `/assets/*` correctly on deep-linked routes), then boots both and runs Playwright against the built app. Booting the API is also the production-parity boot check (a `boot-smoke` job of its own until it was folded in here): the real API bundle, production-shaped (but throwaway/CI-only) secrets, and a poll of `/health/ready` until it responds or the process dies.

Every job that can skip itself on an unaffected PR follows the same "detect affected -> `if: steps.aff.outputs.run == 'true'`" pattern, computed by `scripts/ci/affected.sh <task> <filters...>`, which dry-runs the task and counts the selected tasks; anything it cannot read defaults to `run=true` (fail-open toward "just run it").

### `security-secrets.yml`

Runs `gitleaks` (pinned by version + verified sha256, not just a floating tag) against full git history on push/PR to `main` and weekly on a cron, uploading SARIF to GitHub code scanning (best-effort: `continue-on-error: true` on the upload step, since a private repo without GitHub Advanced Security can't ingest SARIF; the actual gate is `gitleaks`'s own `--exit-code 1`). Config lives in `.gitleaks.toml` at the repo root.

## Observability overlay

`observability/docker-compose.obs.yml` is an optional Compose overlay (LGTM stack: Loki, Grafana, Tempo, Prometheus), layered on top of `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.prod.yml -f observability/docker-compose.obs.yml up -d
```

It joins the same default network so the obs containers can reach `api`/`postgres`/`redis` by service name. Grafana binds to `127.0.0.1:3001` only: it is expected to sit behind the reverse proxy like everything else, never exposed directly. See `docs/observability/README.md` for the production wiring and `apps/api/src/otel.ts` for how the API's OTel SDK connects to the collector when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Logs are **not** shipped via OTel: they stay stdout JSON, scraped by Promtail into Loki.

## Deployment targets

The repo assumes one shape (Dockerfiles, nginx config comments, and `TRUST_PROXY` defaults all follow from it): containers on a Docker host with a TLS-terminating reverse proxy in front.

- **Docker Compose on any host**: `docker-compose.prod.yml` is the reference. A single-host proxy in front is why `TRUST_PROXY=loopback` is the default and why `api` binds to `127.0.0.1` only.
- **Routing**: the per-app images deploy independently, and there is no Compose-level routing glue (the web nginx config's header comment says so): the proxy routes `/trpc`, `/api`, `/socket.io` -> `api` and everything else -> `web`. A self-hosted PaaS (Dokploy, CapRover and similar) can run the same compose file with its own router doing that split.

## S3 usage

Two independent S3 configurations exist for two independent purposes: do not conflate them when configuring an environment:

1. **Application object storage** (`S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`): used by `apps/api/src/modules/storage/storage.service.ts` for user-uploaded files (e.g. avatars). It uses `@aws-sdk/client-s3` plus `@aws-sdk/s3-presigned-post` (client-side direct upload via a presigned POST policy, so S3 itself enforces size/content-type limits) and `@aws-sdk/s3-request-presigner` (presigned GET for downloads/viewing). Local dev points this at the bundled `s3rver` container.
2. **Electron auto-updater releases** (`S3_UPDATE_BUCKET`/`S3_UPDATE_REGION`, read from `process.env` by `apps/desktop/electron-builder.cjs` to build its `publish` block; a publishing build fails if either is unset): a completely separate bucket that `electron-updater` polls for new release manifests/artifacts (`provider: "s3"`, `acl: "public-read"`, `path: "/releases"`, `generateUpdatesFilesForAllChannels: true`). This is desktop-distribution infrastructure, unrelated to the application's runtime object storage, and these two env var pairs are not currently documented in the same place in `.env.example`: keep that in mind when provisioning a new environment for desktop releases.

## Secrets

The only secret-delivery mechanism implemented for the application itself is `.env` files (`env_file: .env` in `docker-compose.prod.yml`). There is no Docker `secrets:` block, no Vault/Doppler/Infisical integration, and no SOPS/age-encrypted env file in this repo. Secret-scanning is handled at the CI layer only (gitleaks, above). Not currently implemented: a runtime secret manager, per-environment secret rotation tooling, or a documented convention for a platform secret store.
