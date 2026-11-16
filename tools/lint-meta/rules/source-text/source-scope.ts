/*
 * Path helpers shared by the source-text rules.
 *
 * The session fences that used to share this module's application-source
 * filter now come from `@noctcore/lint-meta-rules/session`, which scopes by
 * glob (see `SESSION_SCOPE` in tools/lint-meta/registry.ts).
 */

/** A path with Windows separators normalized, so path tests are written once. */
export function toPosix(file: string): string {
  return file.replace(/\\/gu, '/');
}
