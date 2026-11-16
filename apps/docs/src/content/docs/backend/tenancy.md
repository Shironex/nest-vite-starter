---
title: Tenancy
description: The 3-tier Tenant (Organization) to Workspace model, the Prisma $extends scoping boundary, the AsyncLocalStorage request context, and what is and isn't enforced.
sidebar:
  order: 3
---

## The model

The domain calls this an **Organization → Workspace** hierarchy (a customer organization and the workspaces inside it). In the Prisma schema the models are named `Tenant` and `Workspace`: the top tier keeps the generic `Tenant`/`tenantId` name because `tenantId` is the isolation key the tenant-scope extension, the lint rules and the isolation lane are built on, while user-facing copy, routes and identifiers outside the data layer say "organization".

`packages/database/prisma/schema/tenancy.prisma`:

```prisma
// Tenant: the organization (the customer organization). Top of the 3-tier model
// (Tenant -> Workspace -> domain rows). One Tenant owns many Workspaces and Users.
model Tenant {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users  User[]
  workspaces Workspace[]
}

// Workspace: a workspace inside an organization. Scoped under a Tenant.
model Workspace {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, name])
  @@index([tenantId])
}
```

`User.tenantId` is nullable (a User belongs to at most one Tenant, directly - there is no `Membership` many-to-many join model) with `onDelete: Restrict` on the relation, so a `Tenant` cannot be deleted while it still has users. `Workspace.tenantId` is required and cascades on tenant delete.

### Where Workspace lives in code

Workspace is platform, not domain. The api module is `apps/api/src/modules/workspace/`:

- `WorkspacesRouter` serves `workspaces.list` (every staff account, `AuthMiddleware`) and `workspaces.create` / `workspaces.update` (`AdminMiddleware` plus `IdempotencyMiddleware`).
- `WorkspaceService` owns the writes and their audit rows. The actions are `AUDIT_ACTIONS.WORKSPACE_CREATED` / `WORKSPACE_UPDATED`, persisted as `workspace.created` / `workspace.updated`. `AuditLog.action` is append-only evidence filtered and labeled by value, so a persisted value never changes once rows carry it; rename a constant freely, never its value.
- `WorkspaceRepository` holds the `Workspace` queries, all on the tenant-scoped client.
- `WorkspaceLookupService` is the only export: `assertInTenant(workspaceId, tx?)`, the gate every domain write calls before trusting a caller-supplied `workspaceId` (a foreign id resolves to `null` under the scope, so it is refused exactly like a missing one), and `list(tx?)`.

`WorkspaceModule` imports no feature module, and the `api-module-edges` lint-meta rule holds that: `workspace` sits at the bottom of the direction table, below every domain module. The wire schemas are in `packages/shared/src/schemas/workspace.ts`, and the web half is `apps/web/src/features/workspace/` (the `/workspaces` screen, `WorkspaceSelect`, `WorkspaceFormDialog`), which `no-cross-feature-imports` treats like `shared`. Its live-DB proof is `workspace.isolation.spec.ts` in the isolation lane.

### Moving an account between tenants

There is **exactly one sanctioned mutation of `User.tenantId`** in the product, and it is the collision branch of staff-invitation acceptance (`StaffInviteRepository.acceptAndMove`): an address invited into an organization already belonged to an account somewhere else, and the holder of that account accepted. Nothing else moves a user, and a second writer would need the same treatment this one gets.

What that treatment is, and why each part of it is there, is on the [Staff Invitations](/backend/staff-invitations/) page. The three facts that belong here, because they are facts about tenancy rather than about invitations:

- the move runs in a **`Serializable`** transaction, because `Workspace.tenant` cascades and the emptiness check that permits deleting the vacated organization is not atomic against a concurrent insert at READ COMMITTED;
- the vacated organization is deleted only when it holds **no `User` rows at all**, soft-deleted ones included, because `onDelete: Restrict` counts every row and a live-rows-only check would abort the delete with a `P2003` after the caller was told otherwise;

The move is audited as `user.tenant.moved` with both tenant ids and both roles.

`AuditLog` and `Notification` both carry `tenantId` (and `AuditLog` also `workspaceId`) as **plain nullable columns with no foreign key** - audit writes can fire pre-auth (a failed login on an unknown email) with no tenant context yet, and notifications can be system-generated outside a tenant.

Every model in the registry below is scoped by `tenantId`. What still does not exist is the 3rd tier: a row scoped by `workspaceId` as well, like an invoice. The extension is explicitly designed so adding one is a config change rather than a rewrite (see below).

## No Row-Level Security

**There is no Postgres RLS anywhere in this codebase.** A search of every migration file (`packages/database/prisma/migrations`) for `ROW LEVEL SECURITY`, `ENABLE ROW`, or `CREATE POLICY` returns zero hits. Tenant isolation is enforced **solely** at the application layer, by a Prisma `$extends` client extension. The extension's own header comment states this explicitly:

> "There is no Postgres RLS by design, so this app-layer `$extends` is the sole mechanism that keeps one tenant's rows invisible to another."

This is a real, load-bearing design decision, not an oversight: it means any code path that reaches the database through something other than the scoped Prisma client (a raw `$queryRaw`, a second ORM instance, a script run outside the app) bypasses isolation entirely. The isolation test suite (below) proves this directly by demonstrating the unscoped client's leak as a _feature_, not a bug - it's the sanctioned escape hatch for seeds/migrations/system jobs.

## The Prisma `$extends` scoping boundary

`apps/api/src/common/database/tenant-scope.extension.ts`. The registry of what gets scoped:

```ts
export const TENANT_SCOPED_MODELS = {
  workspace: ['tenantId'],
  twoFactorPolicy: ['tenantId'],
} as const satisfies Record<string, readonly string[]>;
```

This is a `Record<modelAccessor, scopeKeys[]>`, deliberately multi-axis: a model can be scoped by more than one key (e.g. a future `invoice: ['tenantId', 'workspaceId']`). **A model absent from this map passes through completely untouched by the extension.** That means `User`, `AuditLog`, `Notification`, `Token`, `Permission`, and `RolePermission` are **not** automatically scoped by this mechanism.

The list above can go stale. Read `TENANT_SCOPED_MODELS` in the extension itself before relying on it.

### How User-scoped queries are actually protected

Since `User` isn't in `TENANT_SCOPED_MODELS`, tenant containment for user-facing operations (role changes, admin deletion, admin list, lockout unlock) is done **manually**, by threading `tenantId` explicitly into repository method signatures and `where` clauses. For example, `apps/api/src/modules/user/user.repository.ts`:

```ts
async updateRoleScoped(userId: string, tenantId: string, role: Role): Promise<number> {
  return this.client.user.updateMany({ where: { id: userId, tenantId }, data: { role } });
}
```

Every call site resolves `tenantId` from the AsyncLocalStorage context (`getTenantId()`) and throws `ForbiddenError` if it's absent, rather than silently omitting the filter. This manual-scoping pattern is what the tenancy lint rules (below) exist to police, since it's easy to forget a `tenantId` filter by hand in a way that the automatic `$extends` boundary would have caught for `Workspace`.

### Fail-closed contract

`requireScope()` resolves every required scope key from the ALS or **throws**:

```ts
function requireScope(modelName, scopeKeys) {
  for (const key of scopeKeys) {
    const value = SCOPE_KEY_RESOLVERS[key]?.();
    if (!value)
      throw new Error(
        `Tenant context required: a ${modelName} query ran with no ${key} in the request context.`,
      );
    scope[key] = value;
  }
  return scope;
}
```

There is no silent unscoped fallback. Code that legitimately needs cross-tenant access (seeds, migrations, isolation tests) must go through `PrismaService.unscoped`, which is itself lint-guarded (see below).

### Per-operation rewrite

One `$allOperations` hook dispatches by model name, then rewrites the operation:

| Operation                                                                                  | Rewrite                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findMany`, `findFirst`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`, `deleteMany` | Inject `where: { ...where, ...scope }`                                                                                                                                                                                                                |
| `findUnique`, `findUniqueOrThrow`, `delete` (singular, by id)                              | Inject scope into `where` too. Prisma's extended `whereUnique` accepts a non-unique field alongside the unique one, so a cross-tenant id simply matches no row: `findUnique` resolves to `null`, while `findUniqueOrThrow` and `delete` raise `P2025` |
| `update`                                                                                   | Inject scope into `where`, **strip** scope keys from `data`, and **reject** a nested write on the relation that owns a scope key (`data: { tenant: { connect } }`). A cross-tenant id raises `P2025`                                                  |
| `updateMany`                                                                               | Inject scope into `where`, **strip** scope keys from `data` (a bulk write can't reassign tenant ownership)                                                                                                                                            |
| `create`, `createMany`                                                                     | Scope stamped onto `data`, spread **last** so it overrides any client-supplied value; a nested write on a scope relation is rejected                                                                                                                  |
| `upsert`                                                                                   | Scope merged into `where`, stamped onto `create`, stripped from `update`; both branches reject a scope-relation write                                                                                                                                 |
| anything else (future Prisma op)                                                           | **Throws** - fail-closed for unenumerated operation types                                                                                                                                                                                             |

Every branch runs the operation through the `query()` callback Prisma hands the
hook, which is bound to the client the call arrived on. That is what keeps a
scoped operation inside an enclosing interactive `$transaction`. An earlier
version routed the four singular operations onto delegates captured from the
root client, which silently moved them off the transaction: the write
autocommitted and survived a rollback, and a read could not observe the
transaction's own uncommitted rows. T11/T11b/T11c pin that behavior.

Two doors lead to the same scope column. `data.tenantId` is the scalar and is
stripped; `data.tenant` is the relation and is **rejected**, because a nested
`connect`/`create`/`update` through it reassigns the row's owner and would
survive a strip that only removed the scalar. The rejection is loud rather than
silent: an incidental scalar in a payload is plausible, a nested write aimed at
the scope relation is not.

`PrismaService` (`apps/api/src/common/database/prisma.service.ts`) exposes both:

```ts
get client(): PrismaClient { return this.scoped; }   // default, tenant-scoped
get unscoped(): PrismaClient { return this.base; }    // raw client, allowlisted use only
```

`BaseRepository` (`apps/api/src/common/database/base.repository.ts`) exposes `this.client` as the scoped client, so every repository extending it goes through the boundary by default.

## AsyncLocalStorage request context

`apps/api/src/common/context/request-context.ts`:

```ts
export interface IRequestContext {
  requestId: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  path?: string;
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  workspaceId?: string;
}
export const requestContext = new AsyncLocalStorage<IRequestContext>();
```

Populated in two stages. **Which middleware opens the scope depends on the transport**, and that distinction is load bearing:

1. Opening the scope, one of:
   - **`RequestContextMiddleware`** (`request-context.module.ts`), an Express middleware registered `forRoutes('*')`, for ordinary HTTP routes.
   - **`TrpcRequestContextMiddleware`** (`common/trpc/trpc-request-context.middleware.ts`), registered **first** in `globalMiddlewares`, for tRPC procedures. This is required because nestjs-trpc mounts its own Express handler during module init, outside the pipeline `forRoutes('*')` feeds - so `/trpc` never reaches the Express middleware and would otherwise run with no store at all.

   Both build the store through the shared `buildRequestContextStore(req)`, seeding `requestId`, `method`, `path`, `ip`, `userAgent`, `traceId`, `spanId`. Neither sets `userId` or `tenantId` - those aren't known yet, since auth hasn't run.

2. **`AuthMiddleware`** (`apps/api/src/modules/auth/middleware/auth.middleware.ts`), a tRPC middleware, mutates the _existing_ ALS store in place after validating the session cookie:

   ```ts
   const store = requestContext.getStore();
   if (!store) {
     throw new Error('Request context missing: AuthMiddleware ran outside the ALS scope. …');
   }
   store.userId = session.userId;
   store.tenantId = session.tenantId ?? undefined;
   ```

   The throw is deliberate. A missing store is a wiring defect, and skipping the write quietly is worse than failing: the only downstream symptom is every tenant-scoped query failing closed one layer later, with a message that names the Prisma extension rather than the scope that was never opened.

   The tRPC scope is opened **per procedure**, not per HTTP request. A batched call carries several procedures over one request; each gets its own store built from the same `req`, so `requestId` still correlates them while per-procedure `userId`/`tenantId` writes cannot bleed across the batch.

`workspaceId` is **never resolved into the ALS today** - the request context type carries the field, and the extension is built to consume it, but `AuthMiddleware` only populates `tenantId`. A `workspaceId`-scoped model added to `TENANT_SCOPED_MODELS` before the auth middleware is extended would (correctly) fail closed on every single request. This is documented directly in the extension's header comment as a known sequencing dependency for a second scoping tier, not a bug.

Services read the context via `getTenantId()` / `getWorkspaceId()` directly (e.g. `lockout.service.ts`, `user.service.ts`), or through `AuditService.log`, which falls back to the ALS when `tenantId`/`userId` aren't passed explicitly.

## Queued work carries tenant context too

BullMQ jobs cross a process boundary where the ALS doesn't automatically follow. `apps/api/src/common/queue/job-context.ts`'s `withJobContext()` snapshots `tenantId`/`workspaceId` (among other fields) onto the job payload before enqueue, and `TracedWorkerHost` rebuilds an `IRequestContext` from that envelope before running the job - so queued work (email delivery, notification dispatch) re-enters the same tenant scope as the request that enqueued it. See [background-jobs.md](/backend/background-jobs/) for the full mechanism.

## Isolation test suite

`apps/api/src/common/database/tenant-isolation.isolation.spec.ts` runs only against a **live Postgres** integration lane (excluded from the fast Jest lane), because it deliberately proves the absence of RLS by demonstrating the unscoped client's leak. Run it with:

```bash
pnpm --filter @repo/api test:integration
```

A companion fast-lane spec,
`apps/api/src/common/database/tenant-scope.extension.spec.ts`, drives the
`$allOperations` hook directly with a stub `query` callback. It needs no
database, so it runs on every CI job. Its main job is the transaction-binding
pin: every scoped operation must execute through `query()`, which catches a
reintroduction of the root-client escape without a live Postgres.

The live lane's named cases:

| Case | What it proves                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------- |
| T1   | Scoped `findMany` returns only the active tenant's rows                                         |
| T2   | Scoped `findUnique` by another tenant's id resolves to `null`                                   |
| T3   | Scoped `findFirst` by another tenant's id resolves to `null`                                    |
| T4   | Cross-tenant `update` by id matches no row and raises `P2025`                                   |
| T4b  | Cross-tenant `deleteMany` by id removes 0 rows (added after a real regression - see below)      |
| T4c  | Cross-tenant `delete` by id matches no row and raises `P2025`                                   |
| T5   | `create` auto-stamps the active tenant id even when the payload never named one                 |
| T6   | Fail-closed: no ALS store, or a store missing `tenantId`, both throw `Tenant context required`  |
| T7   | The sanctioned leak: the `unscoped` client with no ALS requirement sees **both** tenants' rows  |
| T8   | `update` cannot move a row cross-tenant - `data.tenantId` is stripped, other fields still write |
| T8b  | `update` cannot move a row via a nested `data.tenant.connect` relation write                    |
| T8c  | `upsert` cannot move a row via a nested relation write in its `update` branch                   |
| T9   | `create` ignores a client-supplied `tenantId` in `data`, stamps the ALS tenant instead          |
| T10  | `updateMany` cannot move rows cross-tenant - `data.tenantId` is stripped                        |
| T11  | A scoped `update` inside a rolled-back `$transaction` does not persist                          |
| T11b | A scoped `delete` inside a rolled-back `$transaction` does not persist                          |
| T11c | A scoped `findUnique` inside a transaction observes that transaction's uncommitted write        |
| T12  | Two tenants reading the same id in one tick do not cross Prisma's findUnique batch              |
| T13  | A compound-unique selector carrying another tenant's id matches no row                          |

T4b exists because of a real regression: an earlier refactor of the extension briefly dropped the `deleteMany` case from the operation switch, which would have made a scoped `workspace.deleteMany` hit the fail-closed throw. It was caught by the contracts and security-regression reviewers during that session, restored, and pinned by this test case so it can't silently regress again.

## Lint rules enforcing the boundary

From `@noctcore/eslint-plugin-prisma`, wired as `noctcore-prisma/*` in `packages/eslint-config/nestjs.js`, which passes this repo's model lists (`TENANT_MODELS`, `HAND_SCOPED_MODELS`) and allowlists: the published rules know no model names. Each has a doc page under `docs/rules/` in the package.

1. **`no-cross-tenant-id-in-where`** - flags a Prisma call on a tenant-scoped accessor (default `['workspace']`) whose `where.tenantId`/`data.tenantId` value traces back to an untrusted identifier (`input`, `dto`, `body`, `query`, `params`, `req`). Trusted sources (`getTenantId()`, `ctx.tenantId`, `session.tenantId`) never trip it.

   ```ts
   // Violation: tenant id comes from client input, an IDOR vector
   prisma.workspace.findMany({ where: { tenantId: input.tenantId } });
   // Fix: use the resolved context value instead
   prisma.workspace.findMany({ where: { tenantId: getTenantId() } });
   ```

2. **`tenant-scoped-tables-require-where`** - polices only the **unscoped** escape hatch (`this.prisma.unscoped.workspace...`), since the scoped client auto-injects the filter. Requires every configured tenant field to appear as a literal key in `where` for `findMany`, `findFirst`, `findFirstOrThrow`, `updateMany`, `deleteMany`, `count`, `aggregate`, `groupBy` (unique-selector methods like `findUnique` are exempt).

   ```ts
   // Violation: unscoped read with no tenantId in where - reads every tenant's rows
   this.prisma.unscoped.workspace.findMany({ where: { name: 'Northwind' } });
   ```

3. **`tenant-write-must-carry-tenant-id`** - same unscoped-only scope, for `create`/`createMany`. Deliberately biased toward false negatives: only a statically-provable _absence_ of the tenant field in a plain object literal is flagged; any spread or unresolvable shape is silently allowed.

   ```ts
   // Violation: no tenantId key present in a literal create - orphaned row
   this.prisma.unscoped.workspace.create({ data: { name: 'Northwind' } });
   ```

4. **`no-unscoped-prisma-outside-allowlist`** - a blanket ban on `<prisma>.unscoped` access and destructuring, everywhere except: `**/prisma/seed.ts`, `**/prisma/seed-load.ts`, `**/*.seed.ts`, `**/prisma/migrations/**`, `**/*.isolation.spec.ts`, `**/common/database/prisma.service.ts`. Also guards against a `runWithoutTenantScope(...)` escape-hatch function that doesn't exist as real code today (only referenced defensively in this rule's own source/tests) - the rule is future-proofing against a bypass that might be added later.

## Self-signup and role changes, tenant-scoped

Both are covered in depth elsewhere but worth summarizing the tenant angle:

- **Self-signup** (`register.service.ts`) creates the `Tenant` and its owning `ADMIN` user in one transaction - see [users-and-account-lifecycle.md](/backend/users-and-account-lifecycle/#self-signup-creates-a-organization-tenant).
- **Role changes and admin deletion** (`user.service.ts`) resolve `tenantId` from the ALS and fail closed if it's absent, then scope the underlying write by that tenant id, so an admin in one Organization cannot touch a user in another Organization - a cross-tenant `userId` simply matches zero rows. See [auth-and-sessions.md](/backend/auth-and-sessions/#session-revocation-on-role-change).

## Known limitations

- **Raw SQL bypasses the extension.** `$queryRaw`/`$executeRaw` never pass through the Prisma `$extends` hook. The ESLint rule `noctcore-prisma/no-raw-sql-outside-allowlist` restricts where raw SQL may appear; any allowlisted call must scope itself.
- **Relation traversal is not scoped.** A nested `include`/`select` through `Tenant` (e.g. `user.tenant.workspaces`) is not rewritten by the extension. Query scoped models directly rather than through a relation.
- **Tenant deletion** has no cleanup path for a tenant's Workspaces beyond the FK cascade.
- **Deliberately out of scope**: Postgres RLS, fine-grained (CASL-style) permissions, billing, a `Membership` many-to-many model (one tenant per user; see `docs/decisions/2026-09-22-tenant-switching.md`), and per-tenant permission overrides.

## Modifying this area

- **Adding a new tenant-scoped model** (e.g. an `Invoice` model): add one entry to `TENANT_SCOPED_MODELS`, e.g. `invoice: ['tenantId', 'workspaceId']`. If it needs `workspaceId`, you must first extend `AuthMiddleware` to resolve `workspaceId` into the ALS - until then, every request would fail closed on that model, which is the extension behaving correctly, not a bug to route around.
- **Adding a manual-scoping repository method** (the `User`-model pattern): thread `tenantId` explicitly through the method signature, resolve it from `getTenantId()` at the call site, and throw `ForbiddenError` if absent - do not silently omit the filter.
- Before touching this boundary, run the isolation lane locally: `pnpm --filter @repo/api test:integration` (requires a live Postgres - see `apps/api/jest.integration.config.js`).
