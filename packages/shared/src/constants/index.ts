// Shared constants

/*
 * Plain values with no zod in them, so a browser importing one pays for the
 * value and nothing else. The module re-exported here used to live inside
 * `schemas/*.ts`, which meant the web pulled a chunk of zod schemas to read one
 * number; every name is still re-exported from the schema module that enforces
 * it, so no api import path changed.
 */
export * from './list-limits.js';

/**
 * The BCP 47 locale every date, number and money formatter defaults to: the web
 * formatters in `apps/web/src/lib/format.ts`, the web `DateField` (month
 * and weekday names, and the order a date is typed in) and anything the api
 * renders for a person to read.
 *
 * One constant rather than an env key because it is a build-time property of
 * the product copy, like the English strings tables it sits next to: change it here
 * (to `en-GB` for day-first dates, say) and every formatter follows. A product
 * that grows a language switcher derives it from the active language instead.
 */
export const APP_LOCALE = 'en-US';

/**
 * Single source of truth for the product's display name. Every user-facing
 * surface (auth pages, sidebar, email "from" name via the
 * api's APP_NAME config default) derives from this, so rebranding is a
 * one-line change here rather than a repo-wide sweep.
 *
 * 'Nest Vite Starter' is the starter's own name and is expected to change in a fork
 * (the README lists the few surfaces that cannot read a constant, such as the
 * index.html <title>, which duplicate the literal).
 */
export const PRODUCT_NAME = 'Nest Vite Starter';

/**
 * Lowercase machine-safe form of PRODUCT_NAME, for identifiers that are not
 * display copy: the data-export filename prefix, crash-reporter grouping, bucket prefixes.
 * Kept next to PRODUCT_NAME so the two never drift.
 */
export const PRODUCT_SLUG = 'nest-vite-starter';

/**
 * CSRF wire contract, shared by the api (csrf.service.ts reads the header,
 * main.ts registers the token route) and the web client (lib/csrf.ts sends the
 * header and fetches the token). One definition so the two sides cannot drift.
 */
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_TOKEN_PATH = '/api/csrf-token';

/**
 * Auth token lifetimes. Owned here so the api's TokenService (which stamps
 * expiresAt) and the email copy ("This link expires in ...") derive from the
 * same value: bumping a TTL updates the mail prose via formatTokenTtl below.
 */
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
// Email-change confirmation links get the password-reset lifetime, not the
// 24 h verification one: the flow re-keys the login identity, and the user is
// actively at their new mailbox while it runs.
export const EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Human copy for a token TTL at hour granularity: '1 hour', '24 hours'. */
export function formatTokenTtl(ttlMs: number): string {
  const hours = Math.round(ttlMs / (60 * 60 * 1000));
  return hours === 1 ? '1 hour' : `${hours} hours`;
}
