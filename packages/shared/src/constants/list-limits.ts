/**
 * Page sizes, range caps and length bounds, one module, no zod.
 *
 * WHY THEY ARE NOT IN THE SCHEMA MODULES ANY MORE. Each of these numbers is
 * spelled once and read from both sides: the api's zod input enforces it, the
 * web's form and query hook refuse the same thing before a round trip. Their
 * natural home looked like the schema file that enforces them, and that is
 * where they lived, but it costs the browser real bytes: importing one number
 * from `@repo/shared/schemas` pulls the whole schemas chunk into whatever chunk
 * group asked, because a bundler cannot tree-shake across a barrel of
 * zod-constructed values: one number could cost ~7 kB br of zod.
 *
 * `@repo/shared/constants` is a separate tsup entry with no zod in it at all,
 * so the same import from the web costs the number and nothing else. Every one
 * of these is re-exported from the schema module that enforces it, so no api
 * import path changed and `@repo/shared/schemas` still answers for all of them.
 *
 * WHAT BELONGS HERE. A plain value with no zod in its definition, read by both
 * apps. A value derived from a schema (`someSchema.options`) or
 * typed against a schema's inferred type stays where it is: moving it would
 * bring the import back with it and buy nothing.
 */

// --- audit log -------------------------------------------------------------

export const AUDIT_LOG_LIST_DEFAULT_LIMIT = 25;
export const AUDIT_LOG_LIST_MAX_LIMIT = 100;

/**
 * Longest date range one list call may ask for, to bound the scan. Generous on
 * purpose: default retention keeps 365 days, and an inspection question ("every
 * reveal last year") must fit in one filter set.
 */
export const AUDIT_LOG_MAX_RANGE_DAYS = 400;

/** How many actions one quick filter / multi-select may OR together. */
export const AUDIT_LOG_MAX_ACTIONS = 20;
