---
title: Data Layer
description: Prisma 7 setup, migration workflow, the tenant-scoping Prisma extension and AsyncLocalStorage context, and how Redis is used across the API.
sidebar:
  order: 4
---

## Prisma 7 setup

The Prisma schema, generated client, and migrations all live in `packages/database/`. Notable choices:

- **ESM-only generated client.** `packages/database/prisma/schema/schema.prisma`'s `generator client` block outputs to `../generated/prisma` (not `node_modules/.prisma`), and the package is `"type": "module"`. `apps/api` compiles to CJS, so it never imports `@repo/database` with a static `import`: it goes through a dynamic `esmImport()` helper (`apps/api/src/common/utils/esm-import.ts`) instead. This shows up repeatedly in `apps/api/src/common/database/prisma.service.ts` and `apps/api/src/main.ts`.
- **`prisma.config.ts` (Prisma 7's config file, not schema-embedded config).** `packages/database/prisma.config.ts`:

  ```ts
  export default defineConfig({
    schema: 'prisma/schema', // a FOLDER: every .prisma inside is loaded
    migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
    datasource: { url: env('DATABASE_URL') },
  });
  ```

- **Driver adapter, not the legacy binary engine.** `packages/database/src/client.ts` constructs `PrismaPg` (`@prisma/adapter-pg`) explicitly, passing pool sizing read from env: `DB_POOL_MAX` (default 10), `DB_CONNECT_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`. Pool sizing is deployment-topology-sensitive: the comment in `client.ts` spells out that `replicas * DB_POOL_MAX` must stay under Postgres `max_connections`, and that a PgBouncer front-end changes the math.
- **Slow-query extension.** `prisma.$extends(buildSlowQueryExtension())` (`packages/database/src/slow-query.ts`) times every query and logs a structured warning above a configurable threshold (default 200ms). This is a `$extends` applied inside `@repo/database` itself: separate from, and layered underneath, the tenant-scoping extension described below, which is applied one level up in `apps/api`.
- **The exported `prisma` singleton is cast back to `PrismaClient`.** `$extends` technically returns a structurally different type; `packages/database/src/client.ts` casts it back so consumers don't need to know an extension was applied.

## Migration workflow

Scripts (`packages/database/package.json`), run via `pnpm --filter @repo/database <script>`:

| Script               | Command                                                                              | When to use                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `db:generate`        | `prisma generate`                                                                    | Regenerate the client after any schema change (also runs automatically as a Turbo dependency of every `build`)                    |
| `db:migrate`         | `prisma migrate dev`                                                                 | Local development: create + apply a new migration interactively                                                                   |
| `db:migrate:deploy`  | `prisma migrate deploy`                                                              | Apply committed migrations non-interactively (CI, the Docker `migrate` stage, production)                                         |
| `db:migrate:status`  | `prisma migrate status`                                                              | Check whether the DB is up to date with the migrations folder                                                                     |
| `db:migrate:check`   | `prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code` | Fails if the schema diverges from what's actually in the migrations folder, run against a live DB (see the Prisma 7 gotcha below) |
| `db:migrate:resolve` | `prisma migrate resolve`                                                             | Mark a failed migration as applied/rolled-back manually                                                                           |
| `db:push`            | `prisma db push`                                                                     | Schema push with no migration history: dev-only, never for anything with committed migrations                                     |
| `db:seed`            | `tsx prisma/seed.ts`                                                                 | Seed starter permissions + an admin user; refuses to run when `NODE_ENV=production` unless `ALLOW_PRODUCTION_SEED=true`           |
| `db:seed:dev`        | `tsx prisma/seed.ts && tsx prisma/dev.seed.ts`                                       | Dev playground dataset (see below). Destructive, local-only, never run in CI                                                      |
| `db:seed:load`       | `tsx prisma/seed-load.ts`                                                            | Seed data for load testing                                                                                                        |

**Prisma 7 gotcha worth knowing:** `migrate diff` removed the old `--to-schema-datamodel` flag (now `--to-schema`), and `--from-migrations` now requires a shadow database. That makes a no-DB "does the schema match the migrations folder" check impossible without a live database, which is why `db:migrate:check` diffs `--from-config-datasource` (the live DB, already migrated by `db:migrate:deploy`) against the schema, and CI (`.github/workflows/ci.yml`, `test-api` job) runs `db:migrate:deploy` immediately before it as "Gate A", then `db:migrate:check` as "Gate B".

### Dev playground seed (`db:seed:dev`)

`packages/database/prisma/dev.seed.ts` fills a freshly migrated database with a dataset you can actually browse, so the screens have something to render without a human creating rows by hand. Run it from the repo root:

```bash
pnpm db:seed:dev                            # baseline + playground
SEED_2FA_POLICY=true pnpm db:seed:dev       # also seed the org 2FA policy
```

Every account it creates signs in with `P@ssw0rd!Change.Me`, and it prints the admin login on completion.

Things worth knowing before changing it:

- **It is destructive and deliberately so.** Every date is relative to today, so an upsert-keyed re-run a week later would leave stale rows (an "in 7 days" row quietly becoming a 0-day one). It deletes the target tenants' seeded data and rewrites it, re-anchoring the whole dataset each run. Two independent gates stop that reaching anything real: `NODE_ENV=production` is refused outright, and the `DATABASE_URL` host must be in a local allowlist (overridable only via `SEED_DEV_ALLOW_REMOTE=true` **plus** `SEED_DEV_CONFIRM_DATABASE=<database name>`). It never uses `TRUNCATE CASCADE`, which would take out `Permission`, `RolePermission` and the four e2e fixture users.
- **It writes through a raw `PrismaClient`, so the tenant-scope extension is not loaded.** Nothing injects `tenantId`, and a row written with the wrong one is not an error, it is an invisible row. Defense is threefold: scope columns are required arguments on every builder, the composite FKs onto `Workspace(tenantId, id)` and the other scoped parents make disagreement unrepresentable, and a final `verifySeed()` pass re-reads every table with an explicit `where: { tenantId }` and asserts the counts.
- **It seeds a second organization, `control-organization`.** Isolation here rests solely on the Prisma `$extends` extension with no RLS backstop, so a second tenant with its own admin and a handful of rows makes the boundary checkable by eye in under a minute, and `verifySeed()` asserts neither tenant can reach the other's Workspaces.
- **It is not wired into CI, on purpose.** It is a developer tool, and adding it would cost three files that `pre-push-ci-parity` requires to stay byte-identical.

Migrations on disk (`packages/database/prisma/migrations/`): a single baseline, `0_init`, generated
from the schema with `prisma migrate diff --from-empty` plus a hand-appended block of partial
indexes Prisma cannot express. Until your product has deployed a database, regenerate that
baseline when the schema changes instead of stacking new migrations on it; after the first
deployment, add ordinary migrations (see `docs/migration-playbook.md`).

### Schema layout (`packages/database/prisma/schema/`)

The schema is a **folder**, not a single file. Prisma loads every `.prisma`
inside it and resolves relations across them with no imports, so the split is
organizational only. Multi-file schema has been Generally Available since
Prisma 6.7.0.

| File                   | Holds                                               |
| ---------------------- | --------------------------------------------------- |
| `schema.prisma`        | `generator` + `datasource` only                     |
| `identity.prisma`      | accounts, tokens, OAuth links, RBAC, second factors |
| `tenancy.prisma`       | `Tenant` (Organization) and `Workspace`             |
| `audit.prisma`         | `AuditLog`                                          |
| `notifications.prisma` | notification feed and per-user preferences          |

Two consumers read the schema by path and both know it is a directory: the
`db:generate` turbo input glob, and the ESLint plugin's relation parser
(`packages/eslint-plugin-repo/src/utils/prisma-schema.ts`), which concatenates
every file in the folder before deriving the write-fence relation names.

### Current schema shape

Models: `User`, `Tenant`, `Workspace`, `Token`, `Permission`, `RolePermission`, `AuditLog`, `Notification`. Key relationships and constraints worth knowing when extending the schema:

- `User.tenantId` is **nullable** on purpose (a user row can exist before its tenant is provisioned), and the FK uses `onDelete: Restrict` (not `SetNull`) so a `Tenant` cannot be deleted while users still reference it.
- `Workspace.tenantId` is required, `onDelete: Cascade` from `Tenant`, with a `@@unique([tenantId, name])`: two different organizations (tenants) can each have a workspace with the same name.
- `AuditLog` is treated as append-only/immutable; the only sanctioned delete path is the API's audit-log-retention cron respecting `AUDIT_LOG_RETENTION_DAYS`. `userId` is nullable (`onDelete: SetNull`) so pre-auth events (a failed login on an unknown email) can still be recorded.
- `Notification.jobId` is unique and nullable: it's what makes the BullMQ notification-dispatch worker's persist step idempotent under retry (a retried job finds its own row by `jobId` instead of inserting a duplicate).
- Every index comment in the schema documents _which query it exists for_ (e.g. the `User` composite index exists for the admin user list's keyset pagination): read those comments before adding a new query against a scoped model; the answer to "do I need an index" is usually already written down.

## Tenant scoping: the 3-tier Organization -> Workspace model

The domain model is a 3-tier hierarchy: **Tenant** (the "organization": the customer organization that signs up) owns many **Workspace** rows (the workspaces inside it) and many **User** rows. `Workspace`, the per-Organization 2FA policy and every domain model are scoped by `tenantId`. The request context already carries a `workspaceId` slot for the next tier (domain rows nested under a Workspace), but no code path resolves it yet, which is why no model lists it as a scope key.

**There is no Postgres Row-Level Security.** This is a deliberate architectural decision (see `apps/api/src/common/database/tenant-scope.extension.ts`'s file header): the sole isolation boundary is an app-layer Prisma `$extends` hook. Every read, write, and aggregate on a scoped model is rewritten to carry the active scope, resolved from an `AsyncLocalStorage`-backed request context.

### The extension (`apps/api/src/common/database/tenant-scope.extension.ts`)

- `TENANT_SCOPED_MODELS` is the single source of truth for "which models are isolated, and by which keys": currently `{ workspace: ['tenantId'] }`. A model absent from this map passes through the extension untouched. Adding a new tenant-scoped model (e.g. an `invoice` scoped by both `tenantId` and `workspaceId` once a domain model needs it) is a one-line addition to this map: the injection/stripping/fail-closed machinery below is shared.
- **Fail-closed contract.** If a required scope key (e.g. `tenantId`) is missing from the ALS when a scoped-model query runs, the operation throws rather than silently returning unscoped rows. This means any code path that runs outside an HTTP/tRPC request: seeds, CLI scripts, cron jobs: must either establish a scope explicitly or use the escape hatch below.
- **Per-operation rewrite via one `$allOperations` hook**, not per-method handlers, so an operation Prisma adds in the future is fail-closed by default (`default: throw`) rather than silently unscoped:
  - Reads/aggregates/`deleteMany` get `where: { ...where, ...scope }` injected.
  - `updateMany`/`upsert.update` additionally **strip** any client-supplied scope key from the write payload: otherwise a caller could `data: { tenantId: otherTenant }` and donate a row across the tenant boundary.
  - `create`/`createMany`/`upsert.create` **stamp** the active scope onto the payload, overriding anything the caller supplied.
  - Singular `findUnique`/`update`/`delete` are rewritten onto `findFirst`/`updateMany`/`deleteMany` on the **unscoped base delegate** (captured in closure, so the rewrite doesn't recurse back through the extension) with the scope merged into `where`: a cross-tenant id then matches zero rows instead of leaking existence.
- **Escape hatch.** `PrismaService` (`apps/api/src/common/database/prisma.service.ts`) exposes two getters: `client` (the tenant-scoped client: the default for request handlers) and `unscoped` (the raw base client, for seeds/migrations/system jobs/tests only). Reaching for `unscoped` inside a request handler defeats the only isolation boundary in the app, so it is allowlisted and lint-guarded (`no-unscoped-prisma-outside-allowlist` in `@repo/eslint-plugin-repo`, see `build-and-dx.md`).

### The AsyncLocalStorage request context

`apps/api/src/common/context/request-context.ts` defines `IRequestContext` (`requestId`, `userId`, `tenantId`, `workspaceId`, `ip`, `userAgent`, `method`, `path`, `traceId`, `spanId`) and a module-level `AsyncLocalStorage<IRequestContext>` instance, with plain getter functions (`getTenantId()`, `getWorkspaceId()`, `getRequestContext()`, etc.) so any layer (Prisma extension, structured logger, audit service) can read the active context without it being threaded through every function signature.

Two things populate the store, in order, per request:

1. **`RequestContextMiddleware`** (`apps/api/src/common/context/request-context.module.ts`, applied to every route via `consumer.apply(...).forRoutes('*')`) runs first, at the Express layer, and calls `requestContext.run(store, () => next())` with `requestId`/`traceId`/`spanId`/`ip`/`userAgent` populated (trace id/span id come from the active OpenTelemetry span when one exists, otherwise a fresh UUID). `userId` and `tenantId` are not known yet at this point: there's no session lookup at the Express-middleware layer.
2. **`AuthMiddleware`** (`apps/api/src/modules/auth/middleware/auth.middleware.ts`), a tRPC-level middleware applied per-router with `@UseMiddlewares(AuthMiddleware)`, runs after session validation and **mutates the same ALS store in place** (`requestContext.getStore()` returns the object `RequestContextMiddleware` already `.run()`-scoped; setting `store.userId = ...; store.tenantId = ...;` on it is visible to every subsequent read of `getTenantId()` for the rest of the request, including inside the Prisma extension).

This is why a handler that legitimately runs with no tenant (a public/unauthenticated procedure, a cron) must not touch a tenant-scoped model through `PrismaService.client`: there is no tenant in the ALS to inject, so the extension throws by design.

## Redis usage map

A single shared `ioredis` client (`REDIS_CLIENT`, from `apps/api/src/common/redis/redis.module.ts`, a `@Global()` module) plus one dedicated BullMQ connection cover every Redis use in the API. Key construction is centralized in `apps/api/src/common/redis/redis-keys.ts` (`RedisKeys` + `REDIS_KEY_PREFIXES`) so every Redis key in the codebase has one place that defines its shape.

| Use                                                               | Key shape                                                                                                                                                                                                                            | Where                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session storage                                                   | `session:<sessionId>` (sha256 of the session token)                                                                                                                                                                                  | `apps/api/src/modules/auth/services/session.service.ts`                                                                                                                                                                                                                                          |
| Per-user session index (for "log out all devices" / max-sessions) | `user_sessions:<userId>` (a Redis SET of session ids)                                                                                                                                                                                | `session.service.ts`                                                                                                                                                                                                                                                                             |
| Effective-permissions cache                                       | `permissions:<userId>:<role>` (the **role is part of the key on purpose**; without it, a still-valid session on a user's _previous_ role could rebuild and repoison the cache entry between a role downgrade and its session revoke) | `apps/api/src/modules/auth/middleware/permission.middleware.ts`                                                                                                                                                                                                                                  |
| Idempotency cache                                                 | `idem:<scope>:<path>:<bodyHash>`: `scope` is `<userId>` or `<tenantId>:<userId>` when a tenant is active, `bodyHash` is `sha256(idempotency-key + raw body)` (Stripe-style contract)                                                 | `apps/api/src/common/idempotency/idempotency.middleware.ts`                                                                                                                                                                                                                                      |
| Fixed-window rate limiting                                        | `ratelimit:<scope>`                                                                                                                                                                                                                  | `ThrottlerModule` (`@nest-lab/throttler-storage-redis`), wired in `apps/api/src/app.module.ts`: shared storage across replicas so the effective limit doesn't multiply by replica count                                                                                                          |
| BullMQ job queues                                                 | BullMQ's own internal key scheme                                                                                                                                                                                                     | `apps/api/src/common/queue/queue.module.ts`: deliberately a **separate** `ioredis` connection (`createBullRedisConnection`) with `maxRetriesPerRequest: null`, which BullMQ's blocking reads require; the shared `REDIS_CLIENT` uses `maxRetriesPerRequest: 3` and must not be reused for queues |
| Socket.io cross-replica pub/sub                                   | Socket.io's own adapter keyspace                                                                                                                                                                                                     | `apps/api/src/common/websocket/redis-io.adapter.ts`, wired in `apps/api/src/main.ts`: without this, an event emitted from one API replica is invisible to a client connected to a different replica                                                                                              |
| Health check                                                      | a `PING`                                                                                                                                                                                                                             | `apps/api/src/modules/health/indicators/redis.health.ts`                                                                                                                                                                                                                                         |

Redis connection details (`REDIS_URL`) are validated at boot by the Joi schema in `apps/api/src/config/configuration.config.ts` (see `environments-and-config.md`).
