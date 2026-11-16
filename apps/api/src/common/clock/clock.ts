/**
 * The single wall-clock seam for the API.
 *
 * Business logic must read the current time through `now()` / `nowMs()`
 * instead of bare `new Date()` / `Date.now()`. This gives one override point
 * for time-dependent tests (jest can mock this module) and is enforced by the
 * `repo/no-bare-date-now` lint rule, which allowlists only this file plus the
 * elapsed-time measurement sites (latency timers, request duration) where a
 * wall-clock abstraction would be the wrong tool.
 *
 * Intentionally plain functions, not an injectable provider: a function clock
 * is behavior-identical to the native calls it replaces, so the migration off
 * `Date.now()` carries no DI/constructor churn, and tests that need a fixed
 * clock mock this module rather than threading a fake provider through every
 * constructor.
 */

/** Current wall-clock instant. Replaces bare `new Date()`. */
export function now(): Date {
  return new Date();
}

/** Current wall-clock time in epoch milliseconds. Replaces bare `Date.now()`. */
export function nowMs(): number {
  return Date.now();
}

/** Current wall-clock instant as an ISO-8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}
