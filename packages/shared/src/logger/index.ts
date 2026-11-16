// Ambient declarations for universal (Node + browser) compatibility
// without requiring DOM or Node lib in tsconfig
declare const console: {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};
declare const process: { env?: Record<string, string | undefined> } | undefined;

/**
 * Universal logger
 *
 * Works across all environments:
 * - NestJS API (ANSI colored terminal output)
 * - React frontend (browser console with CSS badges)
 *
 * Environment Variables:
 * - LOG_LEVEL: error, warn, info, debug (default: info)
 * - LOG_COLORS: true/false (default: true in Node.js)
 * - LOG_TIMESTAMPS: true/false (default: false)
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

const LOG_LEVEL_NAMES: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};

// ANSI color codes for terminal output
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

// Browser CSS styles for console output
const BROWSER_STYLES = {
  timestamp: 'color: #6b7280; font-size: 11px;',
  context: 'color: #3b82f6; font-weight: 600;',
  reset: 'color: inherit; font-weight: inherit;',
  levels: {
    ERROR:
      'background: #ef4444; color: white; font-weight: bold; padding: 1px 6px; border-radius: 3px;',
    WARN: 'background: #f59e0b; color: white; font-weight: bold; padding: 1px 6px; border-radius: 3px;',
    INFO: 'background: #3b82f6; color: white; font-weight: bold; padding: 1px 6px; border-radius: 3px;',
    DEBUG:
      'background: #8b5cf6; color: white; font-weight: bold; padding: 1px 6px; border-radius: 3px;',
  },
};

const isBrowser = typeof (globalThis as { window?: unknown }).window !== 'undefined';

let currentLogLevel: LogLevel = LogLevel.INFO;

function getEnvVar(name: string): string | undefined {
  if (isBrowser) return undefined;
  try {
    return process?.env?.[name];
  } catch {
    return undefined;
  }
}

let colorsEnabled = !isBrowser && getEnvVar('LOG_COLORS') !== 'false';
let timestampsEnabled = getEnvVar('LOG_TIMESTAMPS') === 'true';

const envLogLevel = getEnvVar('LOG_LEVEL')?.toLowerCase();
if (envLogLevel && LOG_LEVEL_NAMES[envLogLevel] !== undefined) {
  currentLogLevel = LOG_LEVEL_NAMES[envLogLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatShortTime(): string {
  const iso = new Date().toISOString();
  return iso.slice(iso.indexOf('T') + 1, iso.indexOf('T') + 13);
}

function formatNodeLog(level: string, context: string, levelColor: string): string {
  const parts: string[] = [];

  if (timestampsEnabled) {
    parts.push(colorsEnabled ? `${ANSI.gray}${formatTimestamp()}${ANSI.reset}` : formatTimestamp());
  }

  const levelPadded = level.padEnd(5);
  parts.push(colorsEnabled ? `${levelColor}${levelPadded}${ANSI.reset}` : levelPadded);
  parts.push(colorsEnabled ? `${ANSI.blue}[${context}]${ANSI.reset}` : `[${context}]`);

  return parts.join(' ');
}

export interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  context: string;
  message: string;
  /** Present when an Error was passed positionally: { name, message, stack }. */
  err?: unknown;
  data?: unknown;
}

function formatFileLog(level: string, context: string, args: unknown[]): string {
  try {
    return JSON.stringify(buildLogEntry(level, context, args)) + '\n';
  } catch {
    return (
      JSON.stringify({
        timestamp: formatTimestamp(),
        level: level.toLowerCase(),
        context: scrubText(context),
        message: scrubText(String(args)),
      }) + '\n'
    );
  }
}

export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
}

export interface TraceContext {
  traceId?: string | undefined;
  spanId?: string | undefined;
}

export interface LoggerOptions {
  useStderr?: boolean;
  fileTransport?: (message: string) => void;
  /** When true, output JSON (NDJSON) instead of colored text. Useful for production log aggregation. */
  structured?: boolean;
  /** A static requestId to include in every structured log entry. */
  requestId?: string;
  /** A function that returns the current requestId dynamically (e.g., from AsyncLocalStorage). */
  getRequestId?: () => string | undefined;
  /**
   * Function that returns the current trace/span IDs dynamically. When
   * present, every structured log line will include `traceId` / `spanId`
   * fields if either is set. Caller decides resolution strategy (e.g. an ALS
   * lookup of the inbound trace-id).
   */
  getTraceContext?: () => TraceContext | undefined;
}

/**
 * Key-name patterns whose values must never appear in logs or telemetry.
 * Matched case-insensitively as SUBSTRINGS, so compound keys like
 * `accessToken`, `userEmail`, `x-csrf-token`, and `set-cookie` all hit.
 *
 * Single source of truth shared by the structured-log redactor below and the
 * api's Sentry scrubber (apps/api/src/common/observability/sentry-scrub.ts);
 * the two walkers stay separate, only the denylist is shared. Intentionally
 * broad: over-redacting a harmless key named `body`/`notes`/`content` is
 * harmless, leaking a real secret is not.
 *
 * A substring pass cannot tell `userId` from `userEmail`, so anything it
 * shreds by accident belongs in SAFE_KEY_ALLOWLIST below, which is consulted
 * FIRST. Add a pattern here only for a value that is a credential or personal
 * data in its own right, never for an identifier: `userId` is deliberately NOT
 * on this list because the audit trail already stores it raw in a queryable
 * column (AuditLog.userId), so denying it in logs defends nothing the database
 * does not already hold, and costs every 500 its "which account hit this"
 * answer (common/filters/all-exceptions.filter.ts gathers it for exactly that).
 */
export const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token', // accessToken, refreshToken, csrfToken, x-csrf-token
  'authorization',
  'cookie', // covers set-cookie
  'csrf',
  'apikey',
  'api_key',
  'api-key',
  'ssn',
  'card',
  'cvv',
  'cvc',
  'email', // covers userEmail
  'phone',
  'sessionid', // covers sessionId
  'session_id',
  'sid',
  'body', // request body / free-text body fields
  'notes', // free-text notes fields
  'content', // free-text content fields
  'encryptionkey',
  'encryption_key',
  // Personal-data key names. Nothing logs these objects today; listed so a
  // future `logger.error(err, payload)` carrying such an input cannot leak them.
  'bankaccount',
  'bank_account',
  'iban',
  'iddoc', // covers idDocType, idDocNumber(Enc)
  'residencedoc',
  'birthdate',
  'birth_date',
  'emergencycontact',
  'emergency_contact',
] as const;

/**
 * Exact key names that survive redaction even though a SENSITIVE_KEY_PATTERNS
 * substring appears somewhere inside them. Matched case-insensitively as WHOLE
 * keys, so `contentType` is exempt while `noteContent` is not, and `side` is
 * exempt while `sessionIdentifier` is not.
 *
 * Every entry below is a real key name in this repo that the substring pass
 * destroys as collateral, not a hypothetical. What each one is caught by:
 *
 * - `content`: the SHAPE of a payload (its MIME type, its byte count, an S3
 *   listing) is not its contents.
 * - `email`: booleans and enums that record WHETHER mail happened. They never
 *   carry an address; `emailSent` is a published API contract field.
 * - `ssn`: `className` and its variants, which ride React props into the
 *   browser Sentry scrubber (apps/web/src/lib/error-reporting.ts).
 * - `sid`: UI state and document identifiers that merely contain the letters
 *   s-i-d. `sid` as a WHOLE key stays denied, as does anything containing
 *   `sessionid`.
 *
 * Deliberately NOT here: `residenceDoc*`. It is caught by `sid` AND by the
 * `residencedoc` personal-data pattern, and the second one is intentional (an
 * identity-document number), so exempting it would be a real leak.
 */
export const SAFE_KEY_ALLOWLIST = [
  'contenttype',
  'contentlength',
  'contents',
  'contentsecuritypolicy',
  'emailsent',
  'emailverified',
  'classname',
  'avatarclassname',
  'statusclassname',
  'sidebarcollapsed',
  'issnoozeopen',
  'issnoozepending',
  'daysid',
  'side',
  'correctsident',
] as const;

const SAFE_KEYS = new Set<string>(SAFE_KEY_ALLOWLIST);

/**
 * True when a key name must be redacted: an exact SAFE_KEY_ALLOWLIST hit wins,
 * otherwise a case-insensitive SENSITIVE_KEY_PATTERNS substring decides.
 */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SAFE_KEYS.has(k)) return false;
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

const REDACTED = '[REDACTED]';

/**
 * URL path prefixes whose REMAINDER is a bearer credential, not an identifier.
 *
 * The key-name denylist above cannot help here: a credential carried in the
 * path is just part of a string called `path`, so every access log, exception
 * log and trace attribute records it verbatim.
 *
 * A calendar feed is the classic case: its token has to live in the URL
 * because calendar clients subscribe to a plain GET and cannot send a header
 * or a cookie, so the URL IS the credential. A short-lived download ticket is
 * the same shape with a shorter fuse, and a refusal still writes the live
 * value into an ERROR line.
 *
 * Add a prefix here for any future route that authenticates by path segment.
 */
export const CREDENTIAL_PATH_PREFIXES: readonly string[] = [];

/**
 * Redact the credential-bearing tail of a URL path, leaving the route itself
 * legible so access logs and error reports stay useful for debugging.
 *
 * `/api/feed/9f3c...ics` becomes `/api/feed/[REDACTED]`. Everything after
 * the prefix goes, including any query string, so a client that appends one
 * cannot smuggle the token past the redactor.
 */
export function redactCredentialPath(path: string): string {
  for (const prefix of CREDENTIAL_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return `${prefix}${REDACTED}`;
  }
  return path;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a redactor for credential path segments ANYWHERE in a text, for sinks
 * that receive more than a bare pathname: a full URL, a span name, an
 * exception message such as Nest's `Cannot GET <url>`. `redactCredentialPath`
 * cannot serve them, since it matches with `startsWith` on a pathname.
 *
 * Each prefix keeps the route legible and loses its tail up to whitespace or a
 * quote, query string included, so a client that appends one cannot smuggle
 * the token past the redactor. Case-insensitive: the redactor only ever blanks
 * more. Idempotent, so a value redacted upstream passes through unchanged.
 *
 * Takes the prefixes so a boundary with its own credential routes can build its
 * own redactor; the api uses `redactCredentialSegments` below.
 */
export function createCredentialSegmentRedactor(
  prefixes: readonly string[],
): (text: string) => string {
  // An empty alternation would match at every position and blank everything.
  if (prefixes.length === 0) return (text) => text;
  const pattern = new RegExp(`(${prefixes.map(escapeRegExp).join('|')})[^\\s"'<>]*`, 'gi');
  return (text) => text.replace(pattern, `$1${REDACTED}`);
}

/** `CREDENTIAL_PATH_PREFIXES` redacted wherever they appear in a text. */
export const redactCredentialSegments = createCredentialSegmentRedactor(CREDENTIAL_PATH_PREFIXES);

/**
 * Flatten an Error into a plain object so its name, message and stack survive
 * JSON serialization.
 *
 * An Error's own properties are all non-enumerable, so `JSON.stringify(new
 * Error('boom'))` is the string `{}` and `Object.entries(err)` is empty. Every
 * structured sink below therefore has to run values through here before
 * stringifying, or an error handed to a logger is emitted as an empty object
 * with no message and no stack.
 *
 * `cause` is carried one level deep, so a wrapper error does not swallow the
 * failure it was wrapping.
 */
export function normalizeError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  const out: Record<string, unknown> = {
    name: value.name,
    message: value.message,
    stack: value.stack,
  };
  const cause: unknown = (value as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    out.cause = { name: cause.name, message: cause.message, stack: cause.stack };
  }
  return out;
}

/**
 * Deepest level `redactSensitive` walks into. A subtree below it is replaced
 * with DEPTH_REDACTED, never returned as is: "too deep to inspect" must not
 * turn into "publish it", and a driver error's `meta`, an HTTP client's config
 * or a wrapped cause are exactly the objects that nest this far.
 */
const MAX_REDACT_DEPTH = 8;
const DEPTH_REDACTED = '[REDACTED: depth]';

/**
 * Value shapes that are a credential or personal data wherever they appear,
 * whatever key (or message string) carries them. The key-name denylist cannot
 * see a value that has no key: an interpolated message, a free-text error
 * message, a stack trace, a string leaf under an innocuous key.
 *
 * Deliberately narrow, because every pattern here runs over every string
 * leaf of every log line: each shape is specific enough not to shred the ids,
 * timestamps, trace ids (32 and 16 hex) and routes that make a log useful.
 *
 * - PHC password hashes: `$argon2id$v=19$m=...` (Argon2id is what the api
 *   stores), plus the scrypt / pbkdf2 / bcrypt shapes for completeness.
 * - `Bearer <token>`: an Authorization header value quoted into an error.
 * - JWTs: three base64url segments, the first two starting `eyJ` (`{"`).
 * - 64 hex characters: the shape of every opaque token the api mints (session,
 *   invite, reset, trusted-device: `randomBytes(TOKEN_ENTROPY_BYTES)` in hex,
 *   apps/api/src/common/utils/crypto.ts). A SHA-256 digest has the same shape
 *   and goes too; the cost is a less legible content hash, the benefit is that
 *   a raw token interpolated anywhere never survives.
 * - Email addresses.
 *
 * NOT here, on purpose: bare national identifiers. An 11-digit run also
 * matches order numbers, phone numbers without separators and truncated epoch
 * values, so a bare-digits pattern would shred more context than it protects;
 * identifier-bearing KEYS belong in SENSITIVE_KEY_PATTERNS instead.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\$(?:argon2(?:id|i|d)|scrypt|pbkdf2(?:-[a-z0-9]+)?)\$[A-Za-z0-9$=,+/.-]+/g,
  /\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /\b[0-9a-fA-F]{64}\b/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
];

/**
 * Replace every SECRET_VALUE_PATTERNS match in a string with '[REDACTED]',
 * keeping the text around it so the line still says what happened.
 *
 * The value-based half of the redaction boundary; `redactSensitive` is the
 * key-based half and calls this on every string leaf it keeps.
 */
export function scrubText(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Walk a value and replace any key whose name matches SENSITIVE_KEY_PATTERNS
 * with '[REDACTED]', and run every string leaf it keeps through `scrubText`.
 * Pure (does not mutate the input). An object or array deeper than
 * MAX_REDACT_DEPTH becomes DEPTH_REDACTED, which is also what bounds a cycle
 * (a req object, a socket) instead of blowing the stack.
 *
 * Errors are flattened via `normalizeError` on the way through: without that
 * the `typeof value === 'object'` branch below walks their (empty) enumerable
 * entries and returns `{}`, silently discarding the stack of anything logged as
 * `logger.error('failed', err)`.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value !== 'object') return value;
  if (depth > MAX_REDACT_DEPTH) return DEPTH_REDACTED;
  if (value instanceof Error) {
    return redactSensitive(normalizeError(value), depth);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitive(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactSensitive(v, depth + 1);
    }
  }
  return out;
}

/**
 * The `message` field of a structured entry, already redacted.
 *
 * An Error handed in positionally becomes its message rather than `{}` (see
 * `normalizeError`); its stack is not lost, the caller-facing sinks below put
 * the flattened Error in `err` alongside. A string runs through `scrubText`,
 * and any other value is walked by `redactSensitive` BEFORE it is stringified:
 * `logger.log({ email, password })` must not put either into the message.
 */
function resolveMessage(firstArg: unknown): string {
  if (typeof firstArg === 'string') return scrubText(firstArg);
  if (firstArg instanceof Error) return scrubText(firstArg.message);
  return JSON.stringify(redactSensitive(firstArg));
}

/**
 * The one redacted entry both persistent sinks (structured stdout and the file
 * transport) serialize, so the two can never drift apart on what they redact.
 * `bindings` (the per-line correlation fields) sit between the message and the
 * payload, and are scrubbed like everything else: a requestId can arrive from a
 * client header.
 */
function buildLogEntry(
  level: string,
  context: string,
  args: unknown[],
  bindings?: Record<string, string>,
): LogEntry & Record<string, unknown> {
  const firstArg = args.length > 0 ? args[0] : '';
  const entry: LogEntry & Record<string, unknown> = {
    timestamp: formatTimestamp(),
    level: level.toLowerCase() as LogEntry['level'],
    context: scrubText(context),
    message: resolveMessage(firstArg),
  };
  for (const [key, value] of Object.entries(bindings ?? {})) {
    entry[key] = scrubText(value);
  }
  // An Error passed positionally keeps its stack in a dedicated `err` field
  // rather than being collapsed into the message. Redacted, not just
  // normalized: the message and stack carry the same free text as `message`.
  if (firstArg instanceof Error) entry.err = redactSensitive(firstArg);
  if (args.length > 1) {
    const raw = args.length === 2 ? args[1] : args.slice(1);
    entry.data = redactSensitive(raw);
  }
  return entry;
}

function formatStructuredLog(
  level: string,
  context: string,
  args: unknown[],
  requestId?: string,
  traceContext?: TraceContext,
): string {
  const bindings: Record<string, string> = {};
  if (requestId) bindings.requestId = requestId;
  if (traceContext?.traceId) bindings.traceId = traceContext.traceId;
  if (traceContext?.spanId) bindings.spanId = traceContext.spanId;
  try {
    return JSON.stringify(buildLogEntry(level, context, args, bindings));
  } catch {
    const fallback: Record<string, string> = {
      timestamp: formatTimestamp(),
      level: level.toLowerCase(),
      context: scrubText(context),
      message: scrubText(String(args)),
    };
    for (const [key, value] of Object.entries(bindings)) fallback[key] = scrubText(value);
    return JSON.stringify(fallback);
  }
}

export function createLogger(context: string, options?: LoggerOptions): Logger {
  const useStderr = options?.useStderr ?? false;
  const fileTransport = options?.fileTransport;
  const structured = options?.structured ?? false;
  const staticRequestId = options?.requestId;
  const getReqId = options?.getRequestId;
  const getTraceCtx = options?.getTraceContext;

  function resolveRequestId(): string | undefined {
    return staticRequestId ?? getReqId?.();
  }

  function resolveTraceContext(): TraceContext | undefined {
    return getTraceCtx?.();
  }

  if (isBrowser) {
    return {
      error: (...args: unknown[]): void => {
        if (currentLogLevel >= LogLevel.ERROR) {
          console.error(
            `%cERROR%c %c${formatShortTime()}%c %c[${context}]%c`,
            BROWSER_STYLES.levels.ERROR,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.timestamp,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.context,
            BROWSER_STYLES.reset,
            ...args,
          );
        }
      },
      warn: (...args: unknown[]): void => {
        if (currentLogLevel >= LogLevel.WARN) {
          console.warn(
            `%cWARN%c %c${formatShortTime()}%c %c[${context}]%c`,
            BROWSER_STYLES.levels.WARN,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.timestamp,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.context,
            BROWSER_STYLES.reset,
            ...args,
          );
        }
      },
      info: (...args: unknown[]): void => {
        if (currentLogLevel >= LogLevel.INFO) {
          console.log(
            `%cINFO%c %c${formatShortTime()}%c %c[${context}]%c`,
            BROWSER_STYLES.levels.INFO,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.timestamp,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.context,
            BROWSER_STYLES.reset,
            ...args,
          );
        }
      },
      debug: (...args: unknown[]): void => {
        if (currentLogLevel >= LogLevel.DEBUG) {
          console.log(
            `%cDEBUG%c %c${formatShortTime()}%c %c[${context}]%c`,
            BROWSER_STYLES.levels.DEBUG,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.timestamp,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.context,
            BROWSER_STYLES.reset,
            ...args,
          );
        }
      },
      log: (...args: unknown[]): void => {
        if (currentLogLevel >= LogLevel.INFO) {
          console.log(
            `%cINFO%c %c${formatShortTime()}%c %c[${context}]%c`,
            BROWSER_STYLES.levels.INFO,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.timestamp,
            BROWSER_STYLES.reset,
            BROWSER_STYLES.context,
            BROWSER_STYLES.reset,
            ...args,
          );
        }
      },
    };
  }

  const output = useStderr ? console.error : console.log;
  const errorOutput = console.error;

  /*
   * REDACTION BOUNDARY, read before adding a log line.
   *
   * Both persistent sinks (structured stdout and the file transport) emit the
   * entry `buildLogEntry` builds, which redacts in two ways:
   *
   *  - by KEY: `redactSensitive` replaces the value of any key matching
   *    SENSITIVE_KEY_PATTERNS, in the data arguments, in a first-argument
   *    object and in a positional Error;
   *  - by VALUE: `scrubText` removes known secret SHAPES (PHC hashes, Bearer
   *    tokens, JWTs, 64-hex tokens, email addresses) from every string,
   *    the message included.
   *
   * The value pass is a backstop, not a license to interpolate. A name or an
   * address has no fixed shape, so it survives in a message string and is
   * caught only under a denied KEY:
   *
   *     logger.debug(`Stored ${key} for ${password}`)   // leaks, never redacted
   *     logger.debug('Stored object', { key, password }) // password -> [REDACTED]
   *
   * So: identifiers and values belong in the data object, and the message stays
   * a constant string describing what happened.
   *
   * Non-structured (dev) output does not redact at all, by design: it is a
   * developer terminal, not an aggregated log store.
   */
  function emitLog(
    level: string,
    levelColor: string,
    logLevel: LogLevel,
    out: (...a: unknown[]) => void,
    args: unknown[],
  ): void {
    if (currentLogLevel < logLevel) return;
    if (structured) {
      out(formatStructuredLog(level, context, args, resolveRequestId(), resolveTraceContext()));
    } else {
      out(formatNodeLog(level, context, levelColor), ...args);
    }
    if (fileTransport) fileTransport(formatFileLog(level, context, args));
  }

  return {
    error: (...args: unknown[]): void => {
      emitLog('ERROR', ANSI.red, LogLevel.ERROR, errorOutput, args);
    },
    warn: (...args: unknown[]): void => {
      emitLog('WARN', ANSI.yellow, LogLevel.WARN, output, args);
    },
    info: (...args: unknown[]): void => {
      emitLog('INFO', ANSI.cyan, LogLevel.INFO, output, args);
    },
    debug: (...args: unknown[]): void => {
      emitLog('DEBUG', ANSI.magenta, LogLevel.DEBUG, output, args);
    },
    log: (...args: unknown[]): void => {
      emitLog('INFO', ANSI.cyan, LogLevel.INFO, output, args);
    },
  };
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function setColorsEnabled(enabled: boolean): void {
  colorsEnabled = enabled;
}

export function setTimestampsEnabled(enabled: boolean): void {
  timestampsEnabled = enabled;
}
