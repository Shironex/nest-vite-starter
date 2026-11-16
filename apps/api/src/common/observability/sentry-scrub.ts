/**
 * Recursive PII scrubber for Sentry events (API side).
 *
 * Applied via `beforeSend` (events) and `beforeBreadcrumb` (breadcrumbs) on
 * the API `Sentry.init`. Two independent concerns:
 *
 *   1. OS-level leakage. SWC ships readable stack frames, so an exception
 *      raised from an absolute path embeds the build/run machine's username
 *      and home directory in `filename` / `abs_path` / `module` on every
 *      frame, plus possibly in the message and exception values. We rewrite
 *      those paths to anonymized, project-relative forms.
 *   2. App-level PII. Emails, request bodies, free-text content, auth headers,
 *      cookies, tokens, and `userId` may ride along in breadcrumb `data`,
 *      event `extra`, `contexts`, `tags`, or `request`.
 *
 * Recursive, cycle-guarded, and depth-capped so it cannot blow the stack or
 * loop on a self-referential event. The sensitive-key denylist is the shared
 * SENSITIVE_KEY_PATTERNS from @repo/shared/logger (lower-cased substring
 * match, so `accessTokenEnc`, `X-Goog-Channel-Token`, and `set-cookie` all
 * hit) - one list for the structured-log redactor and this scrubber, two
 * separate walkers.
 *
 * The shared list is the FLOOR, not the whole rule. This module sits on a
 * different trust boundary from the structured log: the log is first-party
 * storage, this is egress to a third party with `sendDefaultPii: false`
 * (otel.ts). Anything the shared list allows through because it is harmless
 * in our own storage gets denied again below, so tuning the logger's ergonomics
 * cannot loosen what leaves the building.
 *
 * NOTE: there is no `import * as Sentry` here on purpose. Keeping the module
 * free of the SDK keeps it trivially unit-testable and lets it compile even
 * when Sentry is absent. The event/breadcrumb arguments are typed structurally.
 */

import { isSensitiveKey, redactCredentialSegments } from '@repo/shared/logger';

const REDACTED = '[redacted]';
const MAX_DEPTH = 8;

/**
 * OAuth/OIDC wire fields that the shared substring
 * denylist does not cover. EXACT match (not substring) on purpose: adding
 * `code`/`state` to SENSITIVE_KEY_PATTERNS would shred `statusCode`,
 * `appCode`, `countryCode` and every Redux-ish `state` object across the app.
 * The `*token*` family (`id_token`, `access_token`, ...) already hits the
 * shared list; it is repeated here so this set alone documents the OAuth
 * surface and survives a future narrowing of the shared list.
 */
const OAUTH_SENSITIVE_KEYS = new Set([
  'code',
  'state',
  'nonce',
  'code_verifier',
  'code_challenge',
  'id_token',
  'access_token',
  'refresh_token',
  'token_type',
]);

function isOAuthSensitiveKey(key: string): boolean {
  return OAUTH_SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * The egress identifiers (see EGRESS_IDENTIFIER_PATTERNS below) denied again in
 * their query-string form, so `?userId=usr_9` cannot walk past a rule the
 * `{ userId }` object already fails.
 *
 * `input` is here for the same reason one level up: the web's tRPC
 * httpBatchLink sends every query as `GET /api/trpc/<procs>?batch=1&input=<JSON
 * of every procedure input>`, and an error raised while serving one carries
 * that target as `request.url` and `request.query_string`. The JSON holds
 * record ids and free-text search terms (a surname), so the whole value is
 * blanked and the procedure path in front of the `?` is kept for triage.
 *
 * The same list as `IDENTIFIER_QUERY_KEYS` in apps/web/src/lib/error-reporting.ts:
 * the two Sentry boundaries answer to one policy.
 */
const IDENTIFIER_QUERY_KEYS = ['userid', 'user_id', 'input'] as const;

/**
 * Redact OAuth wire params and identifier params INSIDE strings: a callback
 * URL such as `/auth/oauth/google/callback?code=4/...&state=...` or a tRPC
 * batch target rides Sentry events as `request.url`, `query_string`,
 * breadcrumb messages and exception text, where key-based redaction cannot see
 * it. Matches `key=value` at a query boundary (start, `?`, `&`, `#`) for the
 * keys above and blanks the value.
 */
const REDACTED_QUERY_PARAM_RE = new RegExp(
  `(^|[?&#])(${[...OAUTH_SENSITIVE_KEYS, ...IDENTIFIER_QUERY_KEYS].join('|')})=([^&#\\s]*)`,
  'gi',
);

export function scrubQueryParams(value: string): string {
  return value.replace(REDACTED_QUERY_PARAM_RE, (_m, boundary: string, key: string) => {
    return `${boundary}${key}=${REDACTED}`;
  });
}

/**
 * Every string leaving this module gets all three scrubs: OS paths, sensitive
 * query params, and path-segment credentials (which ride `request.url` and a 404's
 * `Cannot GET <url>` text).
 */
function scrubString(value: string): string {
  return scrubQueryParams(redactCredentialSegments(scrubPathString(value)));
}

/**
 * Person-identifier key names, denied here even though the shared denylist
 * deliberately permits them.
 *
 * SENSITIVE_KEY_PATTERNS treats `userId` as an identifier rather than a secret,
 * on the grounds that the audit trail already stores it raw in a queryable
 * column (AuditLog.userId), so denying it in our own structured logs defends
 * nothing the database does not already hold. That argument is first-party
 * only: what OUR database holds says nothing about what a third party should
 * receive. Sentry is external egress, so the identifier stops here.
 *
 * The web boundary denies the same keys (apps/web/src/lib/error-reporting.ts
 * EGRESS_IDENTIFIER_PATTERNS); the two Sentry boundaries answer to the same
 * policy, so they carry the same list. A key naming a natural person that a
 * product adds belongs in both.
 *
 * Deliberately NOT here: `tenantId` / `workspaceId` / `documentId`. They identify an
 * organization or an opaque record rather than a person, and they are the
 * fields that answer "which customer is broken" on an error report. Redacting
 * them would cost the triage without protecting a data subject.
 *
 * Matched as a SUBSTRING, the same way the shared list matches, so compound
 * names (`actorUserId`, `signerUserId`, `targetUserId`) hit too.
 */
const EGRESS_IDENTIFIER_PATTERNS = ['userid', 'user_id'] as const;

function isEgressIdentifierKey(key: string): boolean {
  const k = key.toLowerCase();
  return EGRESS_IDENTIFIER_PATTERNS.some((p) => k.includes(p));
}

/** Shared-denylist substring match, OR OAuth exact match, OR an egress identifier. */
function isRedactedKey(key: string): boolean {
  return isSensitiveKey(key) || isOAuthSensitiveKey(key) || isEgressIdentifierKey(key);
}

// Username + home-directory paths. Order matters: rewrite the home dir to a
// sentinel first, then collapse any remaining bare username occurrences.
const HOME_DIR = (process.env.HOME || process.env.USERPROFILE || '').trim();
const OS_USER = (process.env.USER || process.env.LOGNAME || process.env.USERNAME || '').trim();

/**
 * Strip the machine's home dir and username out of any string. Used on
 * messages and on every stack-frame path (`filename` / `abs_path` / `module`).
 * `/Users/jane/app/src/foo.ts` becomes `<home>/app/src/foo.ts`, then any stray
 * `jane` becomes `<user>`.
 */
export function scrubPathString(value: string): string {
  let out = value;
  if (HOME_DIR) {
    out = out.split(HOME_DIR).join('<home>');
  }
  if (OS_USER && OS_USER.length >= 3) {
    // Bounded by non-word edges so we don't shred unrelated substrings.
    const re = new RegExp(`\\b${escapeRegExp(OS_USER)}\\b`, 'g');
    out = out.replace(re, '<user>');
  }
  return out;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Built-in "opaque" objects with no introspectable enumerable PII that
 * `Object.entries` would corrupt: wiping a `Date`/`RegExp` to `{}` or
 * exploding a `Buffer`/typed array into a `{ "0": .., "1": .. }` byte map. We
 * return these untouched and let Sentry's own normalizer render them safely.
 * `Map`/`Set`/`Error` are deliberately NOT here: they can carry nested PII, so
 * they get explicit recursive handling in scrubValue below.
 */
function isOpaqueExoticObject(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof Promise ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) // typed arrays, DataView, and Node Buffer
  );
}

/**
 * Recursively redact a value (returns a new tree).
 * - Strings: home/username scrubbed.
 * - Objects/arrays: walked; values under sensitive keys replaced wholesale.
 * - Cycle-guarded via a `WeakSet`; depth-capped at `MAX_DEPTH`.
 */
function scrubValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;

  // Opaque built-ins pass through (see isOpaqueExoticObject). Checked before
  // the cycle guard: they are leaves we never traverse.
  if (isOpaqueExoticObject(value)) return value;

  if (seen.has(value as object)) return REDACTED;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, seen, depth + 1));
  }

  // Error: message/stack are non-enumerable, so Object.entries would drop them.
  // Scrub the path-bearing strings + any enumerable own props and return a
  // plain object. (The primary exception is scrubbed via event.exception, not
  // here; this covers an Error attached to `extra`/breadcrumb data.)
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: scrubString(value.message),
      ...(typeof value.stack === 'string' ? { stack: scrubString(value.stack) } : {}),
    };
    for (const [key, val] of Object.entries(value as unknown as Record<string, unknown>)) {
      out[key] = isRedactedKey(key) ? REDACTED : scrubValue(val, seen, depth + 1);
    }
    return out;
  }

  // Map / Set hold values Object.entries can't reach: recurse into their
  // contents (preserving the container type) so nested tokens/emails are
  // redacted. A sensitive string key redacts its value, matching object rules.
  if (value instanceof Map) {
    const out = new Map<unknown, unknown>();
    for (const [k, v] of value) {
      out.set(
        k,
        typeof k === 'string' && isRedactedKey(k) ? REDACTED : scrubValue(v, seen, depth + 1),
      );
    }
    return out;
  }
  if (value instanceof Set) {
    const out = new Set<unknown>();
    for (const item of value) out.add(scrubValue(item, seen, depth + 1));
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isRedactedKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = scrubValue(val, seen, depth + 1);
    }
  }
  return out;
}

// Structural Sentry shapes, typed locally to keep this module SDK-free.
interface IStackFrame {
  filename?: string;
  abs_path?: string;
  module?: string;
  [k: string]: unknown;
}
interface IExceptionValue {
  value?: string;
  stacktrace?: { frames?: IStackFrame[] };
  [k: string]: unknown;
}
interface ISentryEventLike {
  message?: string;
  exception?: { values?: IExceptionValue[] };
  breadcrumbs?: IBreadcrumbLike[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  request?: Record<string, unknown>;
  [k: string]: unknown;
}
interface IBreadcrumbLike {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

function scrubFrame(frame: IStackFrame): IStackFrame {
  const next: IStackFrame = { ...frame };
  if (typeof next.filename === 'string') next.filename = scrubPathString(next.filename);
  if (typeof next.abs_path === 'string') next.abs_path = scrubPathString(next.abs_path);
  if (typeof next.module === 'string') next.module = scrubPathString(next.module);
  return next;
}

/**
 * `beforeSend` hook. Returns the scrubbed event, or `null` to drop it.
 * Never throws: a scrub failure must not crash the SDK's transport, so a
 * thrown error here drops the event rather than propagating.
 *
 * Typed on a generic object so the SDK's exact `ErrorEvent` (with its index
 * signature + `exactOptionalPropertyTypes`) is accepted at the `Sentry.init`
 * boundary without a cast, while the internal logic works against the
 * structured `ISentryEventLike` view.
 */
export function scrubEvent<T extends Record<string, unknown>>(input: T): T | null {
  try {
    const event = input as ISentryEventLike;
    const seen = new WeakSet<object>();

    if (typeof event.message === 'string') {
      event.message = scrubString(event.message);
    }

    if (event.exception?.values) {
      event.exception.values = event.exception.values.map((ev) => {
        const next: IExceptionValue = { ...ev };
        if (typeof next.value === 'string') next.value = scrubString(next.value);
        if (next.stacktrace?.frames) {
          next.stacktrace = {
            ...next.stacktrace,
            frames: next.stacktrace.frames.map(scrubFrame),
          };
        }
        return next;
      });
    }

    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs
        .map((b) => scrubBreadcrumb(b))
        .filter((b): b is IBreadcrumbLike => b !== null);
    }

    for (const field of ['extra', 'contexts', 'tags', 'request'] as const) {
      const section = event[field];
      if (section && typeof section === 'object') {
        event[field] = scrubValue(section, seen, 0) as Record<string, unknown>;
      }
    }

    return input;
  } catch {
    // A scrub failure must never let an un-scrubbed event ship: drop it.
    return null;
  }
}

/**
 * `beforeBreadcrumb` hook. Returns the scrubbed breadcrumb, or `null` to drop
 * it. The API has no DOM, so there are no `ui.input` breadcrumbs to drop here
 * (that defense lives on the web side); we still deep-scrub `data` so request
 * bodies / headers logged into a breadcrumb can't leak.
 *
 * Generic object param for the same SDK-boundary reason as `scrubEvent`.
 */
export function scrubBreadcrumb<T extends Record<string, unknown>>(input: T): T | null {
  try {
    const breadcrumb = input as IBreadcrumbLike;
    const next = input as IBreadcrumbLike;
    if (typeof breadcrumb.message === 'string') next.message = scrubString(breadcrumb.message);
    if (breadcrumb.data && typeof breadcrumb.data === 'object') {
      next.data = scrubValue(breadcrumb.data, new WeakSet<object>(), 0) as Record<string, unknown>;
    }
    return input;
  } catch {
    return null;
  }
}
