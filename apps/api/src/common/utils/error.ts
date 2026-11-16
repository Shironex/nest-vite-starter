/**
 * The three readings of an unknown thrown value, in one place.
 *
 * `catch` binds `unknown`, so every log line that wants to say WHAT failed has
 * to narrow first, and the api was doing that by hand at four dozen sites, in
 * three shapes and with three different fallbacks (`'unknown'`,
 * `'Unknown error'`, `String(error)`). The cost is not the repetition, it is
 * that the same failure reads differently depending on which module caught it,
 * so a log search for one incident finds only some of it.
 *
 * They are deliberately three functions rather than one: a message, a stack and
 * an Error instance are not interchangeable, and collapsing the stack sites
 * onto the message one would quietly drop the trace from every cron sweep's
 * failure log.
 *
 * `String(error)` for the non-Error case rather than a fixed word: a thrown
 * string, a rejected value from an SDK, a `{ code }` object: printing what it
 * actually was is strictly more than "unknown", and it can never throw. A
 * `null` prints as `'null'`, which is itself the useful fact that something
 * rejected with nothing.
 */

/** What failed, for a log line or an audit metadata field. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Where it failed, for `logger.error(message, stack)`.
 *
 * `undefined` when an Error carries no stack, which is exactly what Nest's
 * logger expects for "no trace available", so this is not a missing fallback.
 */
export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : String(error);
}

/**
 * The value as an Error, for the two APIs that demand one (`stream.destroy`,
 * `logger.error`'s Error overload). Wrapping preserves the original text rather
 * than replacing it, so a non-Error rejection is still legible downstream.
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
