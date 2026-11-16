/**
 * Tenant-isolation Prisma extension (the ONLY isolation boundary).
 *
 * There is no Postgres RLS by design, so this app-layer `$extends` is the sole
 * mechanism that keeps one tenant's rows invisible to another. Every read,
 * write, and aggregate on a scoped model is rewritten to carry the active scope
 * keys resolved from the AsyncLocalStorage request context.
 *
 * Fail-closed contract: if any required scope key is absent from the ALS (system
 * / seed / CLI paths, or a handler that forgot to set context), every scoped
 * operation THROWS rather than returning unscoped rows. Code that legitimately
 * needs cross-tenant access must use `PrismaService.unscoped` (allowlisted and
 * lint-guarded), never the default `client`.
 *
 * Multi-axis ready: each model is scoped by a LIST of keys (`scopeKeys`), not a
 * single tenantId, and a single `$allOperations` hook dispatches by model. Today
 * it scopes only `workspace` by `['tenantId']` (one organization). When a product adds a
 * Workspace-nested aggregate (say an Invoice or a Document), it is one entry in
 * TENANT_SCOPED_MODELS - e.g. `invoice: ['tenantId', 'workspaceId']` - and the same
 * inject/strip/fail-closed machinery enforces BOTH keys, so a copy-the-block
 * mistake cannot ship an aggregate scoped by organization only. The request context
 * already CARRIES `workspaceId` (`IRequestContext.workspaceId` + `getWorkspaceId`), but it
 * does not yet RESOLVE it per request (auth.middleware sets only tenantId), so a
 * `workspaceId`-scoped model must wait until the auth middleware populates workspaceId in
 * the ALS - until then it would (correctly) fail closed on every request. Adding
 * the model is then a config change, not a rewrite of this boundary. A model NOT
 * in the map passes through untouched.
 *
 * Implementation note: `@repo/database` is ESM-only and this app compiles to
 * CJS, so the extension is a plain object (no `Prisma.defineExtension`),
 * mirroring `packages/database/src/slow-query.ts` (top-level `$allOperations`).
 * It imports nothing from `@repo/database` at all - not even a type - because it
 * holds no client reference: every operation runs through the `query()` callback
 * Prisma hands the hook. `$extends` accepts the plain object at runtime; the
 * manual callback param annotations keep it `noImplicitAny`- and lint-clean. The
 * per-operation casts are localized boundary casts (merging scope keys into a
 * `where`/`data`), not bare `any`.
 */
import { getWorkspaceId, getTenantId } from '../context/request-context';
import { InvariantError } from '../errors/invariant-error';

/**
 * Models guarded by the tenant-scope extension, mapped to the scope keys each is
 * filtered by. Single source of truth for "is this model isolated, and by what?".
 * Today: `workspace` by organization (`tenantId`) only. A model absent from this map is
 * passed through untouched by the `$allOperations` hook below.
 */
export const TENANT_SCOPED_MODELS = {
  workspace: ['tenantId'],
  // Per-Organization 2FA enforcement policy. Scoped so an Organization admin can only ever
  // read/write their own tenant's policy; the login-time and cron reads that run
  // outside tenant context deliberately use `unscoped` (allowlisted).
  twoFactorPolicy: ['tenantId'],
  // A Workspace-owned domain model is scoped by `tenantId` ONLY, even though its
  // rows also carry a `workspaceId`: `workspaceId` is never written into the request
  // ALS, so listing it here would throw on EVERY query rather than isolate
  // anything. Enforce workspaceId one layer up (assert the Workspace belongs to the
  // caller's tenant before a write, filter on it explicitly on reads) and back
  // it with a composite `(tenantId, workspaceId) -> Workspace(tenantId, id)` foreign key.
} as const satisfies Record<string, readonly string[]>;

/**
 * A model registry the extension can be built from: delegate accessor to the
 * scope keys it is filtered by. `TENANT_SCOPED_MODELS` is the production one.
 */
export type TenantScopedModelMap = Readonly<Record<string, readonly string[]>>;

/** String-indexable view of the model map for the runtime model lookup. */
const SCOPED_MODEL_KEYS: TenantScopedModelMap = TENANT_SCOPED_MODELS;

/**
 * Resolver for each scope key from the ALS request context. A key listed in a
 * model's `scopeKeys` MUST have a resolver here, or `requireScope` fails closed.
 */
const SCOPE_KEY_RESOLVERS: Record<string, () => string | undefined> = {
  tenantId: getTenantId,
  workspaceId: getWorkspaceId,
};

/**
 * Relation field backing each scope key. A scoped row's owner can be reassigned
 * two ways: by writing the scalar FK (`tenantId`), or by writing THROUGH the
 * relation that owns it (`tenant: { connect: { id } }`). Prisma's singular
 * `update`/`upsert` payloads expose both, so stripping only the scalar leaves
 * the relation as an open second door out of the boundary.
 *
 * Every key in a model's `scopeKeys` MUST have an entry here or the write fails
 * closed - adding a new scope axis cannot silently ship without its guard.
 */
const SCOPE_KEY_RELATIONS: Record<string, string> = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
};

type WhereArgs = { where?: Record<string, unknown> };
type DataArgs = { data?: Record<string, unknown> };
type CreateManyArgs = { data?: Record<string, unknown> | Record<string, unknown>[] };
type UpsertArgs = {
  where?: Record<string, unknown>;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

/**
 * Resolve every scope key for a model or fail closed. Centralized so each model
 * shares one no-context behavior and one error shape. A missing resolver or a
 * missing ALS value both throw, never silently widen the query.
 */
function requireScope(modelName: string, scopeKeys: readonly string[]): Record<string, string> {
  const scope: Record<string, string> = {};
  for (const key of scopeKeys) {
    const value = SCOPE_KEY_RESOLVERS[key]?.();
    if (!value) {
      throw new InvariantError(
        `Tenant context required: a ${modelName} query ran with no ${key} in the request context.`,
      );
    }
    scope[key] = value;
  }
  return scope;
}

/**
 * Return a shallow copy of a write payload with every scope key removed.
 *
 * A scoped row must never change tenant (or workspace). The scope rewrite only
 * narrows the `where`, so a client-supplied `data.tenantId` (or upsert
 * `update.tenantId`) would otherwise reassign the row across the boundary -
 * cross-tenant data donation. Stripping every scope key here keeps the active
 * scope the sole owner of the row through its whole lifetime.
 */
function stripScopeKeys(
  payload: Record<string, unknown> | undefined,
  scopeKeys: readonly string[],
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const copy = { ...payload };
  for (const key of scopeKeys) {
    delete copy[key];
  }
  return copy;
}

/**
 * Reject a write that targets the relation backing a scope key.
 *
 * `stripScopeKeys` removes the scalar FK, but `data: { tenant: { connect: {...} } }`
 * reassigns the very same column through the relation and survives that strip.
 * This is a deliberate THROW rather than a silent strip: unlike a stray
 * `tenantId` in a payload (plausibly incidental), a nested write aimed at the
 * scope relation can only be an attempt to move the row across the boundary, and
 * the boundary fails loudly everywhere else.
 */
function assertNoScopeRelationWrite(
  payload: Record<string, unknown> | undefined,
  scopeKeys: readonly string[],
  modelName: string,
): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  for (const key of scopeKeys) {
    const relation = SCOPE_KEY_RELATIONS[key];
    if (relation === undefined) {
      throw new InvariantError(
        `Tenant-scope extension: no relation registered for scope key '${key}' (add it to SCOPE_KEY_RELATIONS).`,
      );
    }
    if (Object.hasOwn(payload, relation)) {
      throw new InvariantError(
        `Tenant-scope extension: a ${modelName} write may not target the '${relation}' relation; it owns the '${key}' scope key.`,
      );
    }
  }
}

/**
 * Apply the scope to a single scoped-model operation. Every branch runs the real
 * operation through `query()`, the callback Prisma binds to the client the call
 * arrived on - so a call made on an interactive transaction client stays on that
 * transaction's connection. A single switch (not per-operation handlers) so any
 * operation - including ones not enumerated - is fail-closed via `default`.
 */
function applyScopedOperation(args: {
  modelName: string;
  scopeKeys: readonly string[];
  scope: Record<string, string>;
  operation: string;
  opArgs: unknown;
  query: (args: unknown) => Promise<unknown>;
}): Promise<unknown> {
  const { modelName, scopeKeys, scope, operation, opArgs, query } = args;

  switch (operation) {
    // Where-only operations - reads, aggregates, bulk delete, and the singular
    // by-id ops: inject the scope filter into `where`. `query(args)` descends
    // through the rest of the extension stack (slow-query) and runs the real
    // operation.
    //
    // deleteMany qualifies (where-only, no `data` to strip): a scope-merged
    // `where` means a bulk delete can only ever remove the active scope's own
    // rows, never another's.
    //
    // The singular by-id ops qualify because Prisma's extended `whereUnique` (GA
    // since Prisma 5) accepts non-unique fields alongside the unique one - the
    // generated `<Model>WhereUniqueInput` is
    // `Prisma.AtLeast<{ ...scalars }, "id" | ...>` - so a scope key is simply
    // merged into `where`. A cross-scope id then matches no row: findUnique
    // resolves to null, while delete and findUniqueOrThrow raise P2025.
    //
    // Every one of these MUST run through `query()`. Routing an operation to a
    // delegate captured from the root client would run it on the root
    // connection, escaping any enclosing interactive `$transaction`: the write
    // would autocommit and survive a rollback, and a read could not observe the
    // transaction's own uncommitted rows. Covered by T11/T11b/T11c in the
    // isolation lane and by the transaction-binding pin in the unit spec.
    case 'findMany':
    case 'findFirst':
    case 'findFirstOrThrow':
    case 'count':
    case 'aggregate':
    case 'groupBy':
    case 'deleteMany':
    case 'findUnique':
    case 'findUniqueOrThrow':
    case 'delete': {
      const a = (opArgs ?? {}) as WhereArgs;
      return query({ ...a, where: { ...a.where, ...scope } });
    }

    // update/updateMany carry a `data` payload, so both must strip the scope
    // keys: a write like update({ data: { tenantId: other } }) would otherwise
    // donate the row (or, for updateMany, every matching row) across the
    // boundary. The scope is merged into `where` by the same extended
    // `whereUnique` rule described above.
    //
    // Singular `update` also accepts nested relation writes that `updateMany`
    // does not (its payload type has no relation fields), so the relation guard
    // matters most here - see assertNoScopeRelationWrite.
    case 'update':
    case 'updateMany': {
      const a = (opArgs ?? {}) as WhereArgs & DataArgs;
      assertNoScopeRelationWrite(a.data, scopeKeys, modelName);
      return query({
        ...a,
        where: { ...a.where, ...scope },
        data: stripScopeKeys(a.data, scopeKeys),
      });
    }

    // Writes: stamp the scope onto the payload so a row can only be created
    // under the active scope. The relation guard is explicit rather than relying
    // on Prisma rejecting a payload that sets both the relation and its scalar.
    case 'create': {
      const a = (opArgs ?? {}) as DataArgs;
      assertNoScopeRelationWrite(a.data, scopeKeys, modelName);
      return query({ ...a, data: { ...a.data, ...scope } });
    }
    case 'createMany': {
      const a = (opArgs ?? {}) as CreateManyArgs;
      const rows = Array.isArray(a.data) ? a.data : a.data ? [a.data] : [];
      for (const row of rows) {
        assertNoScopeRelationWrite(row, scopeKeys, modelName);
      }
      return query({ ...a, data: rows.map((row) => ({ ...row, ...scope })) });
    }

    // Upsert: scope the lookup AND stamp the scope onto the create branch so
    // neither create nor update can escape the active scope.
    case 'upsert': {
      const a = (opArgs ?? {}) as UpsertArgs;
      assertNoScopeRelationWrite(a.create, scopeKeys, modelName);
      assertNoScopeRelationWrite(a.update, scopeKeys, modelName);
      return query({
        ...a,
        where: { ...a.where, ...scope },
        // create spreads the scope LAST so it overrides any client-supplied
        // value; the update branch strips the scope keys so an existing row can
        // never be moved across the boundary.
        create: { ...a.create, ...scope },
        update: stripScopeKeys(a.update, scopeKeys),
      });
    }

    // Fail-closed for any operation not handled above (e.g. a future Prisma op):
    // never let an unscoped query through.
    default:
      throw new InvariantError(
        `Tenant-scope extension: unhandled ${modelName} operation '${operation}'.`,
      );
  }
}

/**
 * Build the tenant-scope extension. One top-level `$allOperations` hook (the
 * shape `$extends` accepts, mirroring slow-query) dispatches by model: a model in
 * TENANT_SCOPED_MODELS is scoped + fail-closed; any other model (or a raw query
 * with no model) passes through untouched.
 *
 * The raw pass-through is NOT a boundary: this hook cannot parse SQL, so a raw
 * `SELECT ... FROM "Workspace"` here reads every organization. The static guard for it is
 * `noctcore-prisma/no-raw-sql-outside-allowlist` (@noctcore/eslint-plugin-prisma), which allows a
 * raw tagged template only when its text touches no table, and otherwise needs a
 * reviewed allowlist entry.
 *
 * The extension holds NO client reference of its own: every operation is run via
 * the `query()` callback Prisma supplies, which is bound to whichever client the
 * call was made on. That is what keeps a scoped operation inside an enclosing
 * `$transaction` instead of autocommitting on the root connection.
 */
export function buildTenantScopeExtension(scopedModels: TenantScopedModelMap = SCOPED_MODEL_KEYS) {
  return {
    name: 'tenant-scope',
    query: {
      async $allOperations({
        model,
        operation,
        args,
        query,
      }: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }): Promise<unknown> {
        // `$allOperations` reports `model` as the schema model NAME (PascalCase,
        // e.g. "Workspace"); TENANT_SCOPED_MODELS keys by the camelCase client
        // accessor ("workspace"). Uncapitalize the first char to map between them
        // (Prisma's client-accessor convention).
        const accessor =
          model === undefined ? undefined : model.charAt(0).toLowerCase() + model.slice(1);
        const scopeKeys = accessor === undefined ? undefined : scopedModels[accessor];
        // Not a scoped model (or a raw query with no model): pass through. Raw
        // SQL is guarded statically by noctcore-prisma/no-raw-sql-outside-allowlist.
        if (accessor === undefined || scopeKeys === undefined) {
          return query(args);
        }
        const scope = requireScope(accessor, scopeKeys);
        return applyScopedOperation({
          modelName: accessor,
          scopeKeys,
          scope,
          operation,
          opArgs: args,
          query,
        });
      },
    },
  };
}
