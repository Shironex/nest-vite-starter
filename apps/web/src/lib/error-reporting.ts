import { isSensitiveKey } from '@repo/shared/logger';
import { SENTRY_DSN } from './env';

/**
 * Frontend error-reporting facade over @sentry/react, off by default.
 *
 * Enabled only when the SENTRY_DSN runtime config key is a non-empty string.
 *
 * The SDK is loaded via dynamic import inside initErrorReporting() so it never
 * lands in the entry chunk (see error-reporting.sentry.ts for why the import
 * goes through a bridge module). captureException() before (or without) init
 * is a safe no-op, with a console fallback in DEV.
 */

type SentrySdk = typeof import('./error-reporting.sentry');

/** Optional context forwarded to Sentry; ends up in event.extra (scrubbed by beforeSend). */
export interface IErrorReportContext {
  extra?: Record<string, unknown>;
}

/**
 * Structural views of the SDK's event/breadcrumb shapes. Kept local (like
 * apps/api/src/common/observability/sentry-scrub.ts) so the scrub functions
 * are unit-testable without loading the SDK. `object`-typed fields keep the
 * SDK's exact interfaces (which lack index signatures) assignable.
 */
export interface IScrubbableEvent {
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  extra?: object;
  contexts?: object;
  tags?: object;
  request?: object;
}

export interface IScrubbableBreadcrumb {
  message?: string;
  data?: object;
}

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/**
 * Identifier key names denied HERE even though the shared denylist
 * deliberately permits them.
 *
 * SENSITIVE_KEY_PATTERNS treats `userId` as an identifier rather than a
 * secret, because the audit trail already stores it raw
 * in a queryable column, so denying it in our own structured logs defends
 * nothing the database does not already hold. That argument is FIRST-PARTY
 * only: what our database holds says nothing about what a third party should
 * receive. Sentry is external egress with `sendDefaultPii: false`, so the
 * identifier stops here - the same local denial
 * apps/api/src/common/observability/sentry-scrub.ts applies on its own
 * Sentry boundary.
 *
 * Matched as SUBSTRINGS, the way the shared list matches, so compound names
 * (`actorUserId`, `targetUserId`) hit too. A failed tRPC query forwards its
 * `queryKey`, which carries the procedure input verbatim (lib/trpc.ts), so an
 * identifier naming a person has to be denied here as well as in the api.
 *
 * Deliberately NOT here: `documentId`, `jobId` and the like. They identify an
 * opaque record rather than a person, and they are the fields that answer
 * "which record is broken" on an error report. Redacting
 * them would cost the triage without protecting a data subject.
 */
const EGRESS_IDENTIFIER_PATTERNS = ['userid', 'user_id'] as const;

function isEgressIdentifierKey(key: string): boolean {
  const k = key.toLowerCase();
  return EGRESS_IDENTIFIER_PATTERNS.some((p) => k.includes(p));
}

/** Shared-denylist substring match, OR an identifier this boundary denies. */
function isRedactedKey(key: string): boolean {
  return isSensitiveKey(key) || isEgressIdentifierKey(key);
}

/**
 * Credential and identifier names carried as URL SEARCH PARAMS, blanked inside
 * strings because key-based redaction cannot see them: a whole URL is just one
 * string under a key called `url`.
 *
 * This is not hypothetical on this boundary. The browser SDK attaches
 * `event.request.url` from `document.location.href`, and records navigation
 * and fetch breadcrumbs whose `data` holds URLs. Three routes take a live,
 * single-use credential as `?token=` (auth/reset-password, auth/verify-email
 * and auth/confirm-email-change), so an error raised on any of them would ship
 * a redeemable credential to a third party verbatim.
 *
 * The list is deliberately wider than what the app uses today: a false
 * positive costs a slightly less readable Sentry event, a false negative ships
 * a credential. Only the VALUE is blanked, never the route, because "which
 * page broke" is the entire triage value of `request.url`.
 */
const CREDENTIAL_QUERY_KEYS = [
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'secret',
  'password',
  'key',
  'apikey',
  'api_key',
  'auth',
  'authorization',
  'session',
  'otp',
  'sig',
  'signature',
  'ticket',
] as const;

/**
 * The same identifiers EGRESS_IDENTIFIER_PATTERNS denies as object keys,
 * denied again in their query-string form so `?userId=usr_1` on the URL
 * cannot walk past a rule the `{ userId }` object already fails.
 *
 * `input` is here for the same reason one level up: the tRPC httpBatchLink
 * sends every query as `GET /api/trpc/<procs>?batch=1&input=<JSON of every
 * procedure input>`, and the browser SDK records that URL on a `fetch`
 * breadcrumb. The JSON carries whatever the caller passed, which for this app
 * means person identifiers and free-text search terms (a surname). Key-based
 * redaction cannot reach inside a URL string, so the whole value is blanked
 * and the procedure path in front of the `?` is kept: that path is what makes
 * the breadcrumb worth having.
 */
const IDENTIFIER_QUERY_KEYS = ['userid', 'user_id', 'input'] as const;

/** `key=value` at a query boundary (start, `?`, `&`, `#`); the value is blanked. */
const REDACTED_QUERY_PARAM_RE = new RegExp(
  `(^|[?&#])(${[...CREDENTIAL_QUERY_KEYS, ...IDENTIFIER_QUERY_KEYS].join('|')})=([^&#\\s]*)`,
  'gi',
);

/** Blank credential-bearing query values inside one string. */
function scrubCredentialStrings(value: string): string {
  return value.replace(
    REDACTED_QUERY_PARAM_RE,
    (_match, boundary: string, key: string) => `${boundary}${key}=${REDACTED}`,
  );
}

/**
 * Local equivalent of `redactSensitive` from @repo/shared/logger, walking with
 * `isRedactedKey` instead of `isSensitiveKey` and scrubbing every string leaf
 * it passes. Pure, depth-capped, arrays walked element-wise. The walker is
 * local because the shared one is bound to the shared predicate and does not
 * touch strings, and this boundary needs both; the shared list stays the
 * floor, never the ceiling.
 */
function redactForEgress(value: unknown, depth = 0): unknown {
  // Past the cap, redact rather than pass through: an over-deep branch is
  // unreadable in Sentry anyway, and returning it raw would let a nested
  // token ride out under a key nobody walked.
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubCredentialStrings(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactForEgress(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isRedactedKey(key) ? REDACTED : redactForEgress(val, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Pure `beforeSend` scrubber: redacts sensitive keys (SENSITIVE_KEY_PATTERNS
 * from @repo/shared/logger, plus EGRESS_IDENTIFIER_PATTERNS above) in
 * event.extra, event.contexts, event.tags, and event.request, and blanks
 * credentials inside the free-text message and exception values. The section
 * list mirrors the api scrubber's so the two egress paths cannot drift.
 * Returns a new object; never mutates the input.
 */
export function scrubEvent<T extends IScrubbableEvent>(event: T): T {
  const out: IScrubbableEvent = { ...event };
  // Free text, not a key/value tree: an exception raised on a credential
  // page routinely quotes the URL it failed on, which no key name can catch.
  if (typeof out.message === 'string') {
    out.message = scrubCredentialStrings(out.message);
  }
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((value) =>
        typeof value.value === 'string'
          ? { ...value, value: scrubCredentialStrings(value.value) }
          : value,
      ),
    };
  }
  if (out.extra && typeof out.extra === 'object') {
    out.extra = redactForEgress(out.extra) as object;
  }
  if (out.contexts && typeof out.contexts === 'object') {
    out.contexts = redactForEgress(out.contexts) as object;
  }
  if (out.tags && typeof out.tags === 'object') {
    out.tags = redactForEgress(out.tags) as object;
  }
  if (out.request && typeof out.request === 'object') {
    out.request = redactForEgress(out.request) as object;
  }
  return out as T;
}

/**
 * Pure `beforeBreadcrumb` scrubber: redacts sensitive keys in breadcrumb.data,
 * blanks credentials inside the URL strings a navigation or fetch breadcrumb
 * carries, and drops message content that mentions a sensitive key name (a
 * message like "refresh token expired: <value>" often carries the value
 * alongside the name). Returns a new object; never mutates the input.
 */
export function scrubBreadcrumb<T extends IScrubbableBreadcrumb>(breadcrumb: T): T {
  const out: IScrubbableBreadcrumb = { ...breadcrumb };
  if (typeof out.message === 'string') {
    // A message naming a sensitive key usually carries its value beside it, so
    // the whole message goes; anything that survives still gets its URLs
    // scrubbed (a console breadcrumb can quote a credential-bearing link).
    out.message = isRedactedKey(out.message) ? REDACTED : scrubCredentialStrings(out.message);
  }
  if (out.data && typeof out.data === 'object') {
    out.data = redactForEgress(out.data) as object;
  }
  return out as T;
}

/** True when a DSN is configured. */
function isErrorReportingEnabled(): boolean {
  const dsn = SENTRY_DSN;
  return typeof dsn === 'string' && dsn !== '';
}

let sdk: SentrySdk | null = null;
let initPromise: Promise<void> | null = null;

async function loadAndInit(): Promise<void> {
  const dsn = SENTRY_DSN;
  if (typeof dsn !== 'string' || dsn === '') return;
  try {
    const mod = await import('./error-reporting.sentry');
    mod.init({
      dsn,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      // Errors only: no performance tracing, no session replay.
      tracesSampleRate: 0,
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    });
    sdk = mod;
  } catch (error) {
    // A failed SDK load must never break the app; reporting stays disabled.
    if (import.meta.env.DEV) {
      console.error('[error-reporting] init failed', error);
    }
  }
}

/**
 * Fire-and-forget initializer. Loads and configures @sentry/react when
 * enabled; resolves immediately (leaving reporting a no-op) when disabled.
 * Idempotent: repeated calls return the same promise.
 */
export function initErrorReporting(): Promise<void> {
  initPromise ??= isErrorReportingEnabled() ? loadAndInit() : Promise.resolve();
  return initPromise;
}

/**
 * Report an exception. Safe to call at any time: before init it queues behind
 * the in-flight init (or no-ops with a DEV console fallback when init was
 * never started or reporting is disabled).
 */
export function captureException(error: unknown, context?: IErrorReportContext): void {
  if (sdk) {
    sdk.captureException(error, context);
    return;
  }
  if (initPromise) {
    void initPromise.then(() => {
      sdk?.captureException(error, context);
    });
    return;
  }
  if (import.meta.env.DEV) {
    console.debug('[error-reporting] captureException before init (no-op)', error);
  }
}
