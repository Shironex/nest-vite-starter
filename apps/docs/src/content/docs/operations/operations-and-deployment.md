---
title: Operations and Deployment
description: Docker/compose setup, deploying behind a reverse proxy, Electron S3 auto-updates, database migrations, retention crons, and the full environment-variable inventory.
sidebar:
  order: 1
---

## Local development stack

`docker-compose.yml` (repo root) brings up four services for local dev, none of them the app itself (the API and web run via `pnpm dev` / `./start.sh` outside Docker):

| Service    | Image                              | Ports                          | Notes                                                                                                                                                                                   |
| ---------- | ---------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:17-alpine`               | `5432:5432`                    | Container `saas-starter-postgres`, database `saas_starter`, `saas-starter-pgdata` volume, healthcheck via `pg_isready`                                                                  |
| `redis`    | `redis:7-alpine`                   | `6379:6379`                    | Container `saas-starter-redis`, `saas-starter-redis-data` volume, healthcheck via `redis-cli ping`                                                                                      |
| `mailpit`  | `axllent/mailpit`                  | `1025` (SMTP), `8025` (web UI) | Container `saas-starter-mailpit`. Catches all outbound mail in dev; `MP_SMTP_AUTH_ACCEPT_ANY`/`MP_SMTP_AUTH_ALLOW_INSECURE` so the app's SMTP auth (if any) is accepted unconditionally |
| `s3`       | `ghcr.io/clockwisesoftware/s3rver` | `4569`                         | Container `saas-starter-s3`, `saas-starter-s3-data` volume, `saas-starter-uploads` bucket auto-created                                                                                  |

```sh
docker compose up -d
pnpm --filter @repo/database db:migrate:deploy
pnpm dev   # or ./start.sh for the interactive TUI launcher
```

`start.sh` (repo root, ~788 lines) is a dev-only interactive launcher: port checks (3000/5173/6006/5174/6379/5432/1025/8025/4569 via `lsof`), an ANSI arrow-key menu. It is macOS/Linux-only (relies on `tput`/ANSI cursor control) and does not touch production compose, migrations, S3, or TLS, it is purely a local-dev convenience, not a deployment tool.

## Production Docker images

Two per-app Dockerfiles, both multi-stage, both hardened (non-root runtime user, `tini` as PID 1, healthchecks):

### `apps/api/Dockerfile`

Four stages: `deps` (installs dependencies with a BuildKit pnpm-store cache mount), `builder` (generates the Prisma client, `turbo build --filter=@repo/api`), `migrate` (a one-shot image whose only job is `prisma migrate deploy --schema=prisma/schema`, runs as `USER node`), and `runner` (the actual API process).

The runner stage: `USER node` (non-root), `tini` as PID 1 (`ENTRYPOINT ["/usr/bin/tini", "--"]`: proper SIGTERM reaping, since the app relies on `app.enableShutdownHooks()` for graceful drain), a `HEALTHCHECK` hitting `GET /health` via `wget --spider`, and `CMD ["node", "apps/api/dist/src/main.js"]`. Base image is `node:22-slim` (floating tag, not pinned by digest, see [Gaps](#gaps-in-the-current-setup) below), not `node:22-alpine`: see [Apple Silicon builds](#apple-silicon-builds) for why.

### `apps/web/Dockerfile`

Two stages: `builder` (`node:22-slim`, same reason as the API image; installs, runs `pnpm --filter @repo/api generate:trpc` so the web build can typecheck against the generated tRPC client, then `turbo build --filter=@repo/web`), and `runner`: **`nginxinc/nginx-unprivileged:1.29-alpine`** (alpine is fine here, it only serves static files and never touches nestjs-trpc), which runs as a non-root user (UID 101) by default and therefore listens on `8080` internally (unprivileged containers can't bind ports below 1024; the port mapping in compose puts it back on `80` externally). `HEALTHCHECK` hits `GET /healthz` (a trivial `return 200 "ok"` location block in `apps/web/nginx.conf`, distinct from the API's `/health`).

`apps/web/nginx.conf` also carries the full security-header set (HSTS, CSP, Permissions-Policy, etc., see the security-posture doc), gzip for text/JS/CSS/SVG, a `try_files ... /index.html` SPA fallback, and a 1-year immutable cache on `/assets`. The config's header comment notes this image serves the SPA only, **there is no compose-level API reverse proxy baked in**; the reverse proxy in front (Traefik, Caddy, nginx, or a platform router) is expected to route `/trpc`, `/api`, and `/socket.io` to the API service and everything else to this web container.

### `docker-compose.prod.yml`

Five services: `migrate` (the Dockerfile's `migrate` target, `restart: 'no'`, 256M memory limit, runs to completion before anything else starts), `api` (bound to `127.0.0.1:3000:3000`: **loopback only**, since a reverse proxy on the host is expected to terminate TLS and forward in; 1G memory limit / 256M reservation; `depends_on` gates on `postgres`/`redis` healthy **and** `migrate` completed successfully), `web` (port `80:8080`, 128M limit), `postgres` (17-alpine, requires `POSTGRES_PASSWORD` via `${VAR:?required}`: fails fast rather than booting with a blank password), and `redis` (requires `REDIS_PASSWORD` the same way, `--appendonly yes` for AOF persistence so a restart doesn't lose session/queue state, healthcheck uses `CMD-SHELL` specifically so the container shell expands `$REDIS_PASSWORD`: an exec-form `CMD` would pass the literal unexpanded string).

All services carry `restart: unless-stopped`, explicit `deploy.resources.limits`/`reservations`, and `logging: { driver: json-file, options: { max-size: 10m, max-file: '3' } }` (api/web) so container logs don't grow unbounded on the host disk.

Bring it up:

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

Inspect migration state:

```sh
docker compose -f docker-compose.prod.yml run --rm migrate \
  pnpm exec prisma migrate status --schema=prisma/schema
```

If a migration fails, the `api` container never starts (by design, `depends_on: { migrate: { condition: service_completed_successfully } }` prevents the "app shipped but DB still on the old schema" scenario).

### Apple Silicon builds

Both Dockerfiles' build-time stages (`deps`/`builder` for the API, `builder` for web) run on `node:22-slim`, not `node:22-alpine`. `pnpm turbo build --filter=@repo/api` (and `@repo/web#build`, through the turbo graph) depends on `@repo/api#generate:trpc`, which shells out to the `nestjs-trpc` package's native CLI binary. That binary is a glibc-linked ELF:

```sh
$ file native/aarch64-unknown-linux-gnu/nestjs-trpc
ELF 64-bit LSB pie executable, ARM aarch64, ... interpreter /lib/ld-linux-aarch64.so.1, for GNU/Linux 2.0.0
```

`node:22-alpine` ships musl, has no `/lib/ld-linux-aarch64.so.1`, and `execve` fails with `ENOENT` even though the file exists and is executable, on **every** architecture (`aarch64-unknown-linux-gnu` and `x86_64-unknown-linux-gnu` are both glibc builds), not only on Apple Silicon. It is easy to miss because no CI job builds these images (see [Gaps](#gaps-in-the-current-setup)), so only a real `docker build` end to end reveals it.

`node:22-slim` (Debian) has the matching glibc loader, so the same binary runs unmodified; no lockfile or `pnpm-workspace.yaml` change was needed; `nestjs-trpc` already ships a native binary for every platform pnpm resolves, the resolution was never the problem, the base image's libc was. `scripts/fix-trpc-native-perms.mjs` (the root `postinstall` that restores the `+x` bit nestjs-trpc's own npm publish drops on the Linux binaries) is still required on `slim` for the same reason it's required on the host and under `act`. The web image's `runner` stage stays on `nginxinc/nginx-unprivileged:1.29-alpine`: it only serves the built static bundle and never touches Node or nestjs-trpc.

To build locally on a Mac:

```sh
docker build -f apps/api/Dockerfile --target builder -t saas-starter-api-builder .
docker build -f apps/web/Dockerfile --target builder -t saas-starter-web-builder .
```

Both now succeed natively (`linux/arm64`) and under `--platform=linux/amd64` emulation.

## Deploying behind a reverse proxy

`docker-compose.prod.yml` runs on any Docker host: a VM, a bare-metal server, or a self-hosted PaaS that deploys compose files (Dokploy, CapRover and similar). Put a TLS-terminating reverse proxy (Traefik, Caddy, nginx, or your platform's router) in front of it. The notes below apply to every such setup:

- **API port binding**: `127.0.0.1:3000:3000`: the reverse proxy terminates TLS and proxies in. Do not expose the API container directly on a public interface.
- **`TRUST_PROXY=loopback`** is correct only when the reverse proxy reaches the API over `127.0.0.1`. Behind a proxy on a **Docker bridge network** it does not: express refuses to trust the hop, `req.ip` becomes the proxy's bridge address on every request, and every per-IP limiter (login, register, forgot-password, 2FA at 10/60 s, OAuth start and callback, invites, download) collapses into **one shared bucket**. A single unauthenticated client sending ten login attempts a minute then locks login, registration and password reset for the entire deployment, and every audit row records the proxy IP instead of the caller's. For a multi-hop chain (e.g. a CDN in front of your proxy), set `TRUST_PROXY` to a hop count or a specific CIDR per Express's [trust proxy docs](https://expressjs.com/en/guide/behind-proxies.html).

  **Smoke check after every deploy:** make one request from a machine outside the deployment and read the resulting audit row (or an access-log line). If `ipAddress` is a private/bridge address (`172.16.0.0/12`, `10.0.0.0/8`) rather than your real public IP, `TRUST_PROXY` is wrong for this topology: set `TRUST_PROXY=1` (one proxy hop) and redeploy. There is no boot-time detection for this, which is why the check is manual.

- **Sticky sessions**: Socket.IO uses a Redis adapter (`RedisIoAdapter`, wired in `main.ts`) for cross-replica event fan-out, but the proxy still needs sticky sessions configured for the long-poll fallback transport if you ever scale the API to more than one replica.
- **Secrets**: both compose files read from `env_file: .env`: there is no Docker Secrets integration, no Vault/Doppler/SOPS wiring. If your platform has an encrypted secret store (most PaaS tools do), inject the `.env` contents from it rather than leaving a plaintext file on the host filesystem long-term.
- **The optional LGTM observability overlay** (`observability/docker-compose.obs.yml`) is a separate compose file layered on top with `-f`; see the observability doc for the full bring-up procedure, required env vars, and a reverse-proxy label example for fronting Grafana. It is never brought up automatically, always an explicit second `-f` flag.

## Electron desktop distribution and auto-updates

`apps/desktop/electron-builder.cjs` configures the packaged app:

- **Publish target: S3**, not GitHub Releases: `publish: { provider: 's3', bucket, region, path: '/releases', acl: 'public-read' }`, with `bucket` and `region` read from `S3_UPDATE_BUCKET` / `S3_UPDATE_REGION` when the build runs. A build that can publish fails before packaging if either is unset; only an explicit `--publish never` with both unset packages, and it ships no update feed at all. `generateUpdatesFilesForAllChannels: true` produces the `latest.yml`/`latest-mac.yml`/etc. metadata files `electron-updater` reads to decide whether an update is available.
- The updater itself (`apps/desktop/src/main/updater.ts`) is wired to check this feed, but **auto-download and auto-install are currently disabled** (`autoDownload`/`autoInstallOnAppQuit` set to `false`) as a deliberate mitigation until code signing lands, see below. The manual "Download update" action is wired into the UI (`UpdateBanner`, `UpdatesSection`) instead of the automatic path.
- **Code signing is not yet in place**: macOS `identity: null` + `dmg.sign: false` (unsigned; `hardenedRuntime: true` is set but does nothing without a real identity), Windows `signingHashAlgorithms: null` + `sign: null` (unsigned NSIS installer, Windows SmartScreen will warn on every install). Set it up before shipping the desktop app to users: an Apple Developer ID with notarization and a Windows Authenticode certificate typically take weeks to procure, so start early.
- Electron fuses are set correctly: `runAsNode: false`, `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true`, `enableNodeCliInspectArguments: false`, `enableNodeOptionsEnvironmentVariable: false`, `grantFileProtocolExtraPrivileges: false`.
- Linux ships AppImage only (no `.deb`/`.rpm`).
- No CI job builds or publishes desktop artifacts today, the `desktop:package:*` pnpm scripts exist (`package.json`) but nothing uploads to the S3 bucket from GitHub Actions.

**When code signing is ready**: re-enable `autoDownload`, wire an `afterSign` hook (`@electron/notarize` for macOS), and add `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` as CI secrets.

## Database migrations

Full operating manual: `docs/migration-playbook.md`. Key points not to relearn the hard way:

- **Prisma Migrate, not `db push`**, for anything past local dev. `db:migrate` = `prisma migrate dev` (local, generates + applies a new migration folder). `db:migrate:deploy` = `prisma migrate deploy` (CI/prod, applies pending migrations only, no schema-diffing). `db:migrate:status` lists applied/pending. `db:migrate:resolve` manually marks a migration applied/rolled-back for recovery scenarios.
- **Expand-and-contract** is the default pattern for anything destructive (drop/rename/NOT-NULL-on-populated-table/type-change): add the new shape additively in one release, dual-write/backfill in the next, drop the old shape only once nothing reads it. This keeps every release rollback-safe (both app version N and N-1 can run against the current schema at any point).
- **Backfills are separate one-shot scripts** (`tsx scripts/backfill-<x>.ts`), never embedded in `migration.sql`: Prisma migrations should be DDL only. Scripts should be idempotent and batched for large tables.
- **`CREATE INDEX CONCURRENTLY`** cannot run inside a transaction, and Prisma has no directive to opt a migration out of its transaction wrapper, but a migration file containing exactly **one statement** is applied without a transaction wrapper (an undocumented-but-relied-on Prisma behavior). The convention here: put each `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` alone in its own migration folder, nothing else in the file.
- **Rollback**: Prisma generates no `down` SQL. Three options in priority order: (1) forward-fix with a new migration (preferred, keeps history linear), (2) restore from backup, (3) `prisma migrate resolve --rolled-back <name>` to unstick a partially-applied migration (never to "undo" a successful one).
- **`db:migrate:deploy` requires a direct Postgres connection**: not through PgBouncer in transaction-pooling mode (Prisma migrate uses session-level features). If your prod DB sits behind PgBouncer, configure a separate `directUrl` for migrations.
- **`db:migrate:check`** (CI gate, `apps/api` test-api job) is the schema-vs-migrations drift check. Prisma 7 removed the no-DB `--to-schema-datamodel` diff path, so this now runs `migrate diff --from-config-datasource --to-schema ... --exit-code` against a live, already-migrated database, it needs a real DB connection, it cannot run offline.

## Retention crons

Three window-driven `@nestjs/schedule` cron jobs run inside the API process (no separate worker container exists yet, see [Gaps](#gaps-in-the-current-setup)):

| Cron                                | Env var (window)              | Default  | Floor |
| ----------------------------------- | ----------------------------- | -------- | ----- |
| `user-purge.service.ts`             | `USER_PURGE_GRACE_DAYS`       | 30 days  | 0     |
| `audit-retention.service.ts`        | `AUDIT_LOG_RETENTION_DAYS`    | 365 days | 30    |
| `notification-retention.service.ts` | `NOTIFICATION_RETENTION_DAYS` | 90 days  | 7     |

Each has a Joi-enforced floor specifically so a fat-fingered env value can't accidentally gut the compliance trail (audit) or the bell feed (notifications) overnight, or purge accounts with zero grace window by accident. See the security-posture doc for the full user-deletion lifecycle these crons complete.

## Troubleshooting

### Bootstrap dies with a bare `TypeError` and an empty message

Symptom: no route is served, the stack points into `Reflect.getMetadata` inside nestjs-trpc's `RouterFactory`, and the error carries no message at all. It happens on every dev and prod boot, so nothing has to be wrong with the request path.

Cause: `RouterFactory` walks **every provider in the container** and reads `Reflect.getMetadata(key, instance.constructor)`. A provider bound to a value with a **null prototype** has no `constructor`, so the metadata target is `undefined` and `Reflect.getMetadata` throws before a single route is serialized.

The way to produce such a value by accident is to bind an ESM module namespace object: `import * as x from 'pkg'` under the CJS runtime this api compiles to yields exactly that. Bind an ordinary object carrying the functions the injection token's interface declares, not the namespace.

`apps/api/src/app.module.spec.ts` is the compile-smoke that guards it, and it asserts the general invariant rather than the one package: no provider may be bound to a value whose `constructor` is nullish. When you add a stub to that spec for a package it fakes, make the stub a faithful null-prototype namespace, or the assertion is vacuous.

## Environment variable inventory

Single source of truth: **one root `.env.example`** (there are no per-app copies, because split copies drift and disagree). Both `apps/api` (NestJS `ConfigModule`) and `apps/web` (Vite's built-in dotenv loader) read from this same file. The Joi validation schema (`apps/api/src/config/configuration.config.ts`) is the authoritative list of what the API actually requires; a lint-meta rule (`env-cascade-drift`, see the CI/CD doc) fails the build if a Joi key isn't documented in `.env.example`, so the two stay in sync mechanically, not by discipline alone.

### Server / core

| Var              | Required?             | Default                            | Notes                                                                                                                                      |
| ---------------- | --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`           | no                    | `3000`                             |                                                                                                                                            |
| `NODE_ENV`       | no                    | `development`                      | `development` \| `production` \| `test`                                                                                                    |
| `TRUST_PROXY`    | no                    | `loopback`                         | Express trust-proxy depth; see the reverse-proxy notes above                                                                               |
| `LOG_LEVEL`      | no                    | `info`                             | `debug` \| `info` \| `warn` \| `error`                                                                                                     |
| `APP_NAME`       | no                    | from `@repo/shared/constants`      |                                                                                                                                            |
| `APP_URL`        | no                    | `http://localhost:5173`            |                                                                                                                                            |
| `API_PUBLIC_URL` | **yes in production** | `http://localhost:3000` (dev/test) | The API's own public origin; sole source of the OAuth `redirect_uri` - see [Google OAuth deployment](/operations/google-oauth-deployment/) |
| `CORS_ORIGINS`   | no                    | empty                              | Comma-separated allowlist; prod only, dev hard-codes localhost + desktop origin                                                            |

### Database

| Var                                 | Required? | Default        |
| ----------------------------------- | --------- | -------------- |
| `DATABASE_URL`                      | **yes**   | -              |
| `DB_POOL_MAX`                       | no        | 10             |
| `DB_STATEMENT_TIMEOUT_MS`           | no        | 30000          |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | no        | 60000          |
| `AUDIT_LOG_RETENTION_DAYS`          | no        | 365 (floor 30) |
| `NOTIFICATION_RETENTION_DAYS`       | no        | 90 (floor 7)   |
| `USER_PURGE_GRACE_DAYS`             | no        | 30 (floor 0)   |

### Redis

| Var              | Required?                                  |
| ---------------- | ------------------------------------------ |
| `REDIS_URL`      | **yes**                                    |
| `REDIS_PASSWORD` | required by `docker-compose.prod.yml` only |

### Email

| Var                       | Required?                       | Default                                                  |
| ------------------------- | ------------------------------- | -------------------------------------------------------- |
| `EMAIL_PROVIDER`          | no                              | `smtp` (`resend` is a scaffolded-but-unimplemented seam) |
| `RESEND_API_KEY`          | only if `EMAIL_PROVIDER=resend` | -                                                        |
| `SMTP_HOST`               | **yes**                         | -                                                        |
| `SMTP_PORT`               | no                              | 1025                                                     |
| `SMTP_USER` / `SMTP_PASS` | no                              | empty                                                    |
| `SMTP_FROM`               | no                              | `noreply@localhost`                                      |

### Security / auth

| Var                    | Required?                       | Notes                                                                                                                               |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `TURNSTILE_SECRET_KEY` | **yes**                         | Dev uses Cloudflare's public always-pass test key; prod must override, no Joi default                                               |
| `CSRF_SECRET`          | **yes**, min 32 chars           | `openssl rand -hex 32`                                                                                                              |
| `ENCRYPTION_KEY`       | **yes**                         | Must decode to exactly 32 bytes, base64 (44 chars) or hex (64 chars); the API fails closed at boot if missing/malformed/low-entropy |
| `METRICS_BASIC_AUTH`   | **required in production only** | `user:password`; empty disables auth (dev/test only)                                                                                |

### Google OAuth (optional feature)

| Var                                                     | Required? | Notes                                                                                                                                                    |
| ------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET` | no        | Strictly both-or-neither (half a pair fails boot); both empty disables the provider. See [Google OAuth deployment](/operations/google-oauth-deployment/) |
| `OAUTH_ALLOW_SIGNUP`                                    | no        | Default `true`; `false` restricts Google sign-in to already-linked accounts                                                                              |

### S3 / object storage

| Var                                                                       | Required?                                                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | all **yes** (dev points at local s3rver with `S3_ACCESS_KEY=S3RVER`/`S3_SECRET_KEY=S3RVER`, but there is no silent fallback in prod, Joi requires real values) |
| `S3_UPDATE_BUCKET`, `S3_UPDATE_REGION`                                    | electron-builder only, read from `process.env` by `apps/desktop/electron-builder.cjs`, not read by the API                                                     |

### Admin seed

| Var                             | Required?                   | Notes                                                     |
| ------------------------------- | --------------------------- | --------------------------------------------------------- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | optional, used by `db:seed` | The seed script refuses to run when `NODE_ENV=production` |

### Postgres / Redis credentials (docker-compose.prod.yml only)

`POSTGRES_USER`, `POSTGRES_PASSWORD` (required via `${VAR:?}`), `POSTGRES_DB`, `REDIS_PASSWORD` (required via `${VAR:?}`).

### Frontend (Vite, baked into the bundle at build time: never put secrets here)

| Var                       | Required?        | Notes                                                                                                                                                                |
| ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_TURNSTILE_SITE_KEY` | **yes** for prod | Falls back to the always-pass test key when unset, which a real `TURNSTILE_SECRET_KEY` rejects: login, registration and password reset all return `TURNSTILE_FAILED` |
| `VITE_SENTRY_DSN`         | no               | Empty disables web Sentry entirely; ignored inside the Electron renderer regardless                                                                                  |

:::caution[These are BUILD arguments, not runtime env]
Vite inlines every `VITE_*` value into the JS bundle when `apps/web` is built, and
`.dockerignore` excludes `.env` / `.env.*` from the build context. Setting them on the
running `web` container does nothing: the bundle is already minified and served by nginx.
They must reach the **builder stage** of `apps/web/Dockerfile`, which declares them as
`ARG` + `ENV` (and `turbo.json`'s `@repo/web#build.env` lists both so turbo's strict env
mode passes them through and they take part in the build cache key).

- Compose: `docker-compose.prod.yml` forwards them via `build.args`, so put them in the
  `.env` file next to the compose file and rebuild (`docker compose build web`).
- Plain docker: `docker build -f apps/web/Dockerfile --build-arg VITE_TURNSTILE_SITE_KEY=0x... --build-arg VITE_SENTRY_DSN=https://... .`
- A PaaS that builds from Git: add them as **build-time variables** on the web service
  (not runtime variables), then redeploy. A runtime-only variable silently produces a test-key build.

To confirm a built image actually carries the key:
`docker run --rm <image> sh -c 'grep -rl 0x... /usr/share/nginx/html/assets | head -1'`.
:::

There is deliberately no `VITE_API_URL`: the web SPA reaches the API via relative URLs (dev proxy, or the platform router in prod), and the Electron main process passes the API URL to the renderer over IPC instead.

### Desktop (Electron main process)

| Var                  | Required? | Default                                                       |
| -------------------- | --------- | ------------------------------------------------------------- |
| `API_URL`            | no        | `http://localhost:3000`                                       |
| `CRASH_REPORTER_URL` | no        | empty (disables crash-dump upload; see the observability doc) |

### Observability stack (only needed if running the optional LGTM overlay)

`GRAFANA_ADMIN_PASSWORD` (no default, startup fails without it), `METRICS_USER`/`METRICS_PASSWORD` (must combine to equal `METRICS_BASIC_AUTH` above), `LOKI_RETENTION_PERIOD` (default `744h` = 31d), `TEMPO_RETENTION_HOURS` (default 72), `PROM_RETENTION_DAYS` (default `15d`).

### OpenTelemetry

`OTEL_EXPORTER_OTLP_ENDPOINT` (empty disables the SDK entirely, default), `OTEL_EXPORTER_OTLP_PROTOCOL` (default `http/protobuf`, the only protocol actually wired), `OTEL_SERVICE_NAME` (default `@repo/api`).

### Sentry (API)

`SENTRY_DSN` (empty disables Sentry entirely, default, zero egress), `SENTRY_ENVIRONMENT` (overrides the `NODE_ENV`-derived tag), `APP_VERSION` (names the release; the runner launches `dist/main.js` directly so `npm_package_version` is unavailable at runtime, set this as a Dockerfile build arg for a real release name).

## Gaps in the current setup

- **No backup/DR automation.** No Postgres backup sidecar (pgBackRest/WAL-G/`pg_dump` cron) in either compose file, no tested restore procedure, no documented RTO/RPO. Add either your platform's managed daily snapshot or a backup sidecar with retention, plus S3 versioning and MFA delete on the updater bucket. Redis AOF persistence is on (`--appendonly yes`), which at least survives a container restart, but that's not a substitute for point-in-time backup.
- **Docker base images are floating tags**, not pinned by digest (`node:22-slim`, `nginxinc/nginx-unprivileged:1.29-alpine`, `postgres:17-alpine`, `redis:7-alpine`). A rebuild six months from now may pull a different underlying image than what was tested. Dependabot's `docker` ecosystem entries will surface updates, but there's no digest pin to make a rebuild fully reproducible today.
- **No worker/API process split.** BullMQ queues and their workers run inside the same API container/process as the HTTP server. A separate `worker` container would let an HTTP deploy leave in-flight jobs alone and vice versa; not implemented.
- **No image publish/registry pipeline.** CI builds and tests the app but does not build or push Docker images to any registry (no GHCR, no `docker/build-push-action`, no image signing via `cosign`, no SBOM generation, no container scanning via Trivy/Grype). Deployment today means building the images directly from source on the target host (a PaaS build-from-Git flow, or a manual `docker compose ... up -d --build`).
- **Electron code signing**: covered above; procure the certificates before shipping the desktop app.
- **No SOPS/age/Vault/Doppler integration** for secret delivery, `.env` files (from a platform secret store, or a plain file on the host) are the only mechanism today.
