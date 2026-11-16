/*
 * The starter's soft-delete registry: this repo's decisions about its own
 * models, kept as data rather than inside config or rule source.
 * packages/eslint-config/nestjs.js passes it to the Prisma rules, so
 * registering a soft-deletable model is an edit to this file and nothing else
 * on the lint side.
 */

/**
 * Models carrying a `deletedAt` soft-delete column, policed by
 * `noctcore-prisma/soft-deletable-tables-require-deleted-at`. A model is here
 * because its rows OUTLIVE their delete and nothing injects the filter that
 * hides them.
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
