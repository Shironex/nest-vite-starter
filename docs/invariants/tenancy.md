---
subsystem: Tenant scope
globs:
  - apps/api/src/common/database/tenant-scope.extension.ts
  - apps/api/src/common/context/*.ts
  - apps/api/src/common/tenancy/*.ts
  - apps/api/src/modules/**/*.repository.ts
  - apps/api/src/modules/**/*.service.ts
  - packages/database/prisma/schema/*.prisma
---

# Tenant scope

The starter is a three-tier Organization to Workspace (tenant to workspace) model and there is **no Postgres RLS**. The application
layer is the only boundary: a Prisma `$extends` scope (`tenant-scope.extension.ts`) plus a tenant
`AsyncLocalStorage` context seeded per request. Everything below follows from that one fact, which
is also why the isolation lane runs against a real database rather than a mock.

## Entry points

- `apps/api/src/common/database/tenant-scope.extension.ts` - `TENANT_SCOPED_MODELS` and the
  `query()` hook that injects the tenant id.
- `apps/api/src/common/context/request-context.ts` and `require-tenant-id.ts` - the ALS store.
- `apps/api/src/common/tenancy/cross-tenant-iterator.ts` - the sanctioned way to leave the scope.
- Every `*.repository.ts` and `*.service.ts` under `apps/api/src/modules`.
- `packages/database/prisma/schema/*.prisma` - a new model is a new decision.

## Risks

- A Prisma promise is lazy, so it escapes `requestContext.run` unless it is awaited inside the
  scope. The failure mode is fail-closed (a throw), which is the good direction, but it is the
  most common surprise on this seam.
- A nested `include` never gets the extension's tenant injection.
- Only `query()` is transaction-bound, which is how the transaction escape happened.
- A new model added to the schema is unscoped until somebody says otherwise; silence is a decision.
- The scope RELATION is a second door past a scalar strip: stripping `tenantId` from a `where` is
  not enough when the relation can carry it.

## Invariants

### Every tenant-scoped model in the schema is classified in the registry

**Enforced by:** `lint-meta:tenant-model-registry-parity`, `file:apps/api/src/common/database/tenant-scope.extension.ts`

A model is scoped, hand-scoped, pending, or unscoped by design, and the rule reconciles the Prisma
schema against those four lists. A new model cannot land unclassified, which is the whole point. Whether each scoped model is
actually tested is a separate question, answered by the isolation canary (`pnpm canary:isolation`).

### A read of a tenant-scoped table carries a `where`

**Enforced by:** `eslint:noctcore-prisma/tenant-scoped-tables-require-where`

### A write to a tenant-scoped table carries the tenant id

**Enforced by:** `eslint:noctcore-prisma/tenant-write-must-carry-tenant-id`

### A `where` never carries a tenant id from the request

**Enforced by:** `eslint:noctcore-prisma/no-cross-tenant-id-in-where`

The tenant comes from the ALS, never from the caller. A procedure that accepts a `tenantId` input
and passes it through has reintroduced the boundary as a parameter.

### The unscoped Prisma client is reachable only from an allowlist

**Enforced by:** `eslint:noctcore-prisma/no-unscoped-prisma-outside-allowlist`, `eslint:noctcore-prisma/no-raw-sql-outside-allowlist`

Raw SQL is the same hole by another name, so it has its own allowlist.

### A multi-row write runs in a transaction, and inside one uses `tx`

**Enforced by:** `eslint:noctcore-prisma/prisma-write-in-transaction`, `eslint:noctcore-prisma/prisma-tx-uses-tx-not-client`

The second half is the one that bit: a transaction that reaches for the outer client is outside
both the transaction and the scope that `query()` bound.

### The boundary holds against a real database, per model

**Enforced by:** `file:apps/api/src/common/database/tenant-isolation.isolation.spec.ts`, `file:apps/api/src/common/database/tenant-scope-coverage.isolation.spec.ts`, `file:tools/canary/isolation-canary.json`

`pnpm canary:isolation` un-scopes one model at a time and requires the named cases to go red. A
model whose cases stay green is a hole in the lane, not a passing model.

### A deliberate cross-tenant read goes through the iterator

**Enforced by:** `unenforced`, follow-up in `docs/invariants/README.md#unenforced-invariants`

Today only the Prisma allowlist above makes a cross-tenant read visible. Nothing requires that such
a read go through `cross-tenant-iterator.ts`, so a second hand-rolled loop would pass every gate.

## Review checklist

- [ ] Does a new Prisma model appear in `TENANT_SCOPED_MODELS`, `HAND_SCOPED_MODELS`,
      `HAND_SCOPE_PENDING` or `UNSCOPED_BY_DESIGN`, and is that the right one of the four?
- [ ] Is every Prisma promise awaited inside the `requestContext.run` that seeded the tenant?
- [ ] Does any new `include` reach a tenant-scoped relation that the extension will not filter?
- [ ] If the change adds a cross-tenant read, does it go through `cross-tenant-iterator.ts`, and is
      the reason written next to it?
- [ ] If a model was added, does `tools/canary/isolation-canary.json` name cases that must fail?
