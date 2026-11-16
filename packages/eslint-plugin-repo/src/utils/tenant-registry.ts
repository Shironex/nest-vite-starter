/*
 * the starter's tenant registry: the DATA half of the registry-vs-schema gate.
 *
 * The check itself (`reconcileTenantRegistry`) and the rule that enforces
 * `HAND_SCOPED_MODELS` (`tenant-scoped-tables-require-where`) come from
 * @noctcore/eslint-plugin-prisma, which ships no model names. Everything below
 * is this repo's decisions about its own models, so it lives here as data
 * rather than inside config or rule source: packages/eslint-config/nestjs.js
 * passes it to the Prisma rules, and the `tenant-model-registry-parity`
 * lint:meta rule reads the first three maps directly and `TENANT_MODELS`
 * through the resolved config. Registering a model is an edit to this file and
 * nothing else on the lint side.
 */

/**
 * Tenant-bearing models the runtime extension deliberately does NOT isolate,
 * with the reason each is safe. An entry here is a decision on the record; a
 * tenant-bearing model in neither this map nor `TENANT_SCOPED_MODELS` is an
 * oversight, and `reconcileTenantRegistry` is what tells the two apart.
 *
 * Keys are Prisma delegate accessors, matching `TENANT_SCOPED_MODELS`.
 */
export const UNSCOPED_BY_DESIGN: Readonly<Record<string, string>> = {
  auditLog:
    'The audit trail must accept pre-auth writes (a failed login on an unknown email has no tenant yet), which is why the column is nullable. A fail-closed $allOperations hook would reject exactly the security events that matter most. Reads are scoped by hand in audit-read.repository.ts, which filters on the ALS tenantId.',
  notification:
    'Mirrors AuditLog: a nullable scope column with no FK, written by crons and workers that run outside any tenant context. Every read is self-scoped by userId (a notification belongs to one user, not to a tenant), so the boundary is the session, not the extension.',
  user: 'User is the row that CARRIES the tenant, so the extension cannot scope it without a circular dependency: login, registration and password reset all have to read a user BEFORE any tenant context exists, and a fail-closed hook would break every unauthenticated path. Scoped by hand instead: every read keys on ctx.user.id or passes an explicit tenantId from the ALS.',
};

/**
 * The columns that stand in for the extension on a model it does not isolate:
 * delegate accessor to the scope fields a query on it must filter by, ANY ONE of
 * which counts (`noctcore-prisma/tenant-scoped-tables-require-where`'s `handScopedModels`
 * option).
 *
 * This is the enforcement half of `UNSCOPED_BY_DESIGN`. "Scoped by hand" was a
 * sentence in a comment and nothing else: nothing checked it, so the next
 * `auditLog.findMany({ where: { targetId } })` for a history panel would
 * type-check, pass its unit test and return every organization's rows.
 *
 * Why each list is what it is:
 *
 *   - `auditLog`: `tenantId`, the column the feed filters on. The visibility
 *     clause in audit-read.repository.ts also matches rows whose tenantId is
 *     null through their actor (`user: { tenantId }`), which still mentions the
 *     field, so the rule sees the scope in either arm.
 *   - `notification`: `userId`, because a notification belongs to a user rather
 *     than to a tenant, so the session is the boundary. `jobId` is the one
 *     legitimate exception: the dispatch worker's retry-idempotency lookup keys
 *     on the globally unique job id it just handled, before any user is in hand.
 *
 * A model listed here is policed on EVERY receiver (the extended client, `tx`
 * and `unscoped` alike), unlike the extension-scoped models, which only need the
 * guard on the unscoped escape hatch.
 */
export const HAND_SCOPED_MODELS: Readonly<Record<string, readonly string[]>> = {
  auditLog: ['tenantId'],
  notification: ['userId', 'jobId'],
};

/**
 * Unscoped-by-design models that have no `HAND_SCOPED_MODELS` entry yet, with
 * what it would take to add one. Every other key of `UNSCOPED_BY_DESIGN` must be
 * hand-scope-enforced, so the next model exempted from the extension cannot skip
 * the static guard by simply not mentioning it.
 */
export const HAND_SCOPE_PENDING: Readonly<Record<string, string>> = {
  user: 'User is read by id on dozens of paths that have no tenant and no session yet (login, registration, password reset), so a single required scope field does not exist for it. It needs its own pass over those call sites first.',
};

/**
 * Models the three tenant rules in packages/eslint-config/nestjs.js police. The
 * published rules know no model names (two of them police nothing without this list), so a model added to the
 * runtime boundary (TENANT_SCOPED_MODELS in
 * apps/api/src/common/database/tenant-scope.extension.ts) without being added
 * here gets the runtime filter but NO static enforcement.
 *
 * The two lists are held in step mechanically: the `tenant-model-registry-parity`
 * lint:meta rule reads TENANT_SCOPED_MODELS and the RESOLVED option each of the
 * three rules receives, and fails naming the model that is missing on
 * whichever side. Add a model to the extension without adding it here (or vice
 * versa) and `pnpm lint:meta` is red before the push.
 */
export const TENANT_MODELS: readonly string[] = ['workspace', 'twoFactorPolicy'];

/**
 * Files exempt from `tenant-scoped-tables-require-where` ONLY. Exact files,
 * never a glob over a directory: each exemption is for one sweep, not for
 * anything that later lands beside it.
 *
 * The audit retention sweep is exempt for the HAND-SCOPED half of the rule
 * (`HAND_SCOPED_MODELS`, above): it pages every tenant's expired AuditLog rows
 * by `createdAt` and deletes them by id, which is a system job with no tenant
 * and no user, so neither `tenantId` nor `userId` belongs in its where. The
 * file touches ONLY its own hand-scoped model, so exempting the file exempts
 * nothing else.
 *
 * The purge's audit PII scrub (the scrub-on-purge policy) is a second case of the
 * same shape. It finds ONE purged user's AuditLog rows by that user's id, and it is
 * cross-tenant by design: a user's rows carry a null tenantId (writes made before
 * they authenticated) or a PREVIOUS organization's (an account that moved
 * between organizations), so a tenantId filter would leave exactly the rows the
 * scrub exists to erase. It touches only AuditLog, like the retention sweep, and
 * is exempted by exact path for the same reason.
 */
export const TENANT_WHERE_ALLOW_IN: readonly string[] = [
  '**/modules/audit/audit-retention.service.ts',
  '**/modules/audit/audit-pii-scrub.service.ts',
];

/**
 * Models carrying a `deletedAt` soft-delete column, policed by
 * `noctcore-prisma/soft-deletable-tables-require-deleted-at`.
 *
 * Deliberately NOT the same list as TENANT_MODELS and not derived from it: the
 * two sets answer different questions. A model is in TENANT_MODELS because the
 * runtime `$extends` boundary injects its tenant column; a model is here
 * because its rows OUTLIVE their delete and nothing injects the filter that
 * hides them. `User` is soft-deletable and not tenant-scoped by the extension;
 * most tenant-scoped models are hard-deleted. Any overlap is coincidence, so
 * there is no parity to enforce between them.
 *
 * Sourced from the schema's `deletedAt` columns, starting with `User.deletedAt`
 * (packages/database/prisma/schema/identity.prisma). Add a model here when a
 * migration gives another model a `deletedAt`.
 */
export const SOFT_DELETE_MODELS: readonly string[] = ['user'];

/** One `allowInFunctions` entry of `soft-deletable-tables-require-deleted-at`. */
export interface ISoftDeleteFunctionExemption {
  readonly files: readonly string[];
  readonly functions: readonly string[];
}

/**
 * Functions exempt from `soft-deletable-tables-require-deleted-at` ONLY, each
 * in the one file its glob names. Each names its own call in a comment at the
 * call site.
 *
 *  - user-purge.service.ts `sweep`: reads the expired rows with an explicit
 *    `deletedAt: { lte: cutoff }` filter and hard-deletes each one by primary
 *    key. The purge is the one job whose SUBJECT is the soft-deleted rows.
 *
 * Functions, not files: a file-level `allowIn` also stopped policing the
 * compliant calls beside these, so an edit there could drop the filter without
 * turning CI red. A named helper declared inside one of these functions is
 * policed as its own function.
 *
 * An exemption list rather than an "already narrowed by a unique id" carve-out
 * in the rule, and that is the load-bearing choice: `where: { id }` is the
 * single most common shape in the repo, so a rule treating it as compliant
 * would stop reporting the lockout counters and the role change, which are
 * exactly the sites this guard exists to catch.
 *
 * Exact files, never a directory glob: each exemption is for one call site, not
 * for whatever lands beside it later.
 */
export const SOFT_DELETE_ALLOW_IN_FUNCTIONS: readonly ISoftDeleteFunctionExemption[] = [
  { files: ['**/modules/user/user-purge.service.ts'], functions: ['sweep'] },
];
