import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { QUEUE_WORKER_MODES } from '../common/queue/queue-worker';
import { nowIso } from '../common/clock/clock';
import { InvariantError } from '../common/errors/invariant-error';
import { COMMITTED_TEST_SECRETS } from './committed-test-secrets';

/**
 * The api's environment, parsed once at boot. `ConfigModule.forRoot({ validate })`
 * in AppModule and WorkerModule calls `validateEnv`, so a bad key stops the
 * process before any module is built, and the error names every bad key at once
 * (never a value, since most of these are secrets).
 *
 * Rules that only make sense together, or only in production, live in
 * `productionIssues` below. Each of them closes a specific misconfiguration that
 * would otherwise boot fine and fail open; the unit tests in env.spec.ts pin one
 * test per refusal.
 *
 * `.env.example` lists exactly these keys (plus the few another process reads);
 * env-example.spec.ts keeps the two in step.
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Bytes a production CSRF_SECRET must carry at minimum (256 bits). */
export const CSRF_SECRET_MIN_BYTES = 32;

/**
 * Cloudflare's published Turnstile test secrets (always pass, always fail,
 * token already spent). The always-pass one is what dev uses; in production any
 * of them means the captcha checks nothing.
 */
const TURNSTILE_TEST_SECRET = /^[123]x0+AA$/u;

/** EncryptionService key: 32 bytes as base64 (44 chars) or hex (64 chars). */
const ENCRYPTION_KEY_PATTERN = /^(?:[A-Za-z0-9+/]{43}=|[0-9a-fA-F]{64})$/u;

type RawEnv = Readonly<Record<string, string | undefined>>;

/** Optional keys treat an empty value as unset, so `KEY=` in a .env means "off". */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = () => z.preprocess(blankToUndefined, z.string().trim().optional());

/**
 * A whole number written as digits only. `Number()` alone would accept `1e3`,
 * `0x10`, `1.0` or `true`-adjacent junk; a hop count or a pool size should be
 * exactly what it looks like.
 */
const wholeNumber = (fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .preprocess(
      blankToUndefined,
      z.string().trim().regex(/^\d+$/u, 'must be a whole number (digits only)').optional(),
    )
    .transform((value) => (value === undefined ? fallback : Number(value)))
    .pipe(z.number().int().min(min).max(max));

/**
 * `true` or `false`, nothing else. Unset means "use the default"; an EMPTY value
 * is an error, never false: `KEY=` reading as false is how a half-edited .env
 * silently turns a protection off.
 */
const strictBoolean = () =>
  z
    .enum(['true', 'false'], { error: "must be exactly 'true' or 'false' (empty is not allowed)" })
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'));

const httpUrl = () =>
  z.url({ protocol: /^https?$/u, error: 'must be an http(s) URL such as https://app.example.com' });

/** True when Intl knows the zone, i.e. it is an IANA name (or `UTC`). */
function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * An origin as the browser sends it: scheme, host and optional port, nothing
 * after. `https://app.example.com/` or `.../app` never equals an Origin header,
 * so CORS would refuse every request with nothing saying why.
 */
function isBareOrigin(entry: string): boolean {
  try {
    const url = new URL(entry);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === entry;
  } catch {
    return false;
  }
}

/**
 * IPv4-mapped IPv6 forms of 127.0.0.0/8 and 0.0.0.0, written dotted
 * (`::ffff:127.0.0.1`) or hex the way the URL parser normalises them
 * (`::ffff:7f00:1`, `::ffff:0:0`).
 */
const MAPPED_LOOPBACK_V6 =
  /^::ffff:(?:127\.\d+\.\d+\.\d+|0\.0\.0\.0|7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)$/u;

/**
 * localhost, *.localhost and the loopback / unspecified addresses, IPv4 or
 * IPv6 (including IPv4-mapped). One trailing dot is stripped first:
 * `localhost.` is the fully qualified spelling of the same name.
 */
function isLoopbackUrl(value: string): boolean {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.startsWith('[') && host.endsWith(']')) {
    const ip = host.slice(1, -1);
    return ip === '::1' || ip === '::' || MAPPED_LOOPBACK_V6.test(ip);
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\.\d+\.\d+\.\d+$/u.test(host) ||
    host === '0.0.0.0'
  );
}

export const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(NODE_ENVS),
  PORT: wholeNumber(3000, 1, 65535),
  LOG_LEVEL: z.preprocess(blankToUndefined, z.enum(LOG_LEVELS).default('info')),
  // Express `trust proxy` as a hop count: 0 trusts nothing (the api faces
  // clients directly), 1 is one reverse proxy (Coolify/Traefik, nginx, Caddy).
  // Never `true`: that trusts every X-Forwarded-For hop, so any client picks
  // its own req.ip and walks around every per-IP rate limit.
  TRUST_PROXY: wholeNumber(0, 0),

  // Database (read by @repo/database at module scope; validated here too)
  DATABASE_URL: z.url({
    protocol: /^postgres(?:ql)?$/u,
    error: 'must be a postgres:// or postgresql:// URL',
  }),
  DB_POOL_MAX: wholeNumber(10, 1),
  DB_CONNECT_TIMEOUT_MS: wholeNumber(5000, 0),
  DB_IDLE_TIMEOUT_MS: wholeNumber(10000, 0),
  DB_STATEMENT_TIMEOUT_MS: wholeNumber(30000, 0),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: wholeNumber(60000, 0),

  // Redis and the queue
  REDIS_URL: z.url({ protocol: /^rediss?$/u, error: 'must be a redis:// or rediss:// URL' }),
  QUEUE_WORKER: z.preprocess(blankToUndefined, z.enum(QUEUE_WORKER_MODES).default('inline')),

  // App
  APP_NAME: z.preprocess(blankToUndefined, z.string().trim().default(PRODUCT_NAME)),
  APP_URL: httpUrl(),
  APP_TIME_ZONE: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .default('UTC')
      .refine(isKnownTimeZone, 'must be an IANA time zone such as UTC or America/New_York'),
  ),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform(splitList)
    .refine(
      (origins) => origins.every(isBareOrigin),
      'must be a comma list of bare origins such as https://app.example.com (no path, no trailing slash)',
    ),
  TOTP_ISSUER: optionalText(),

  // Mail (SMTP)
  SMTP_HOST: optionalText(),
  SMTP_PORT: z
    .preprocess(
      blankToUndefined,
      z.string().trim().regex(/^\d+$/u, 'must be a whole number (digits only)').optional(),
    )
    .transform((value) => (value === undefined ? undefined : Number(value)))
    .pipe(z.number().int().min(1).max(65535).optional()),
  SMTP_USER: optionalText(),
  SMTP_PASS: optionalText(),
  MAIL_FROM: optionalText(),
  SMTP_REQUIRE_TLS: strictBoolean(),

  // Captcha (Cloudflare Turnstile)
  TURNSTILE_SECRET_KEY: optionalText(),
  CAPTCHA_DISABLED: strictBoolean(),

  // Secrets
  CSRF_SECRET: optionalText().refine(
    (value) => value === undefined || Buffer.byteLength(value) >= CSRF_SECRET_MIN_BYTES,
    `must be at least ${CSRF_SECRET_MIN_BYTES} bytes (generate one with: openssl rand -hex 32)`,
  ),
  ENCRYPTION_KEY: z
    .string({ error: 'is required (generate one with: openssl rand -base64 32)' })
    .regex(
      ENCRYPTION_KEY_PATTERN,
      'must be 32 bytes as base64 (openssl rand -base64 32) or hex (openssl rand -hex 32)',
    ),

  // Retention
  AUDIT_LOG_RETENTION_DAYS: wholeNumber(365, 30),
  USER_PURGE_GRACE_DAYS: wholeNumber(30, 0),

  // Sentry (read by instrument.ts at module scope; empty means never initialised)
  SENTRY_DSN: z.preprocess(blankToUndefined, z.url({ error: 'must be a DSN URL' }).optional()),
  SENTRY_ENVIRONMENT: optionalText(),
  APP_VERSION: optionalText(),
});

/** One bad key, by name. Values are never part of an issue. */
export interface IEnvIssue {
  readonly key: string;
  readonly message: string;
}

/**
 * Rules for NODE_ENV=production that compare keys or reject values a dev setup
 * legitimately uses. Read from the raw input so they report alongside the
 * per-key errors instead of hiding behind them.
 */
function productionIssues(raw: RawEnv): IEnvIssue[] {
  const issues: IEnvIssue[] = [];
  const blank = (key: string): boolean => (raw[key] ?? '').trim() === '';

  // CORS: the explicit list, or APP_URL's origin when the list is empty.
  const listed = splitList(raw['CORS_ORIGINS']);
  if (listed.some(isLoopbackUrl)) {
    issues.push({
      key: 'CORS_ORIGINS',
      message: 'must not name localhost or a loopback address in production',
    });
  }
  if (!blank('APP_URL') && isLoopbackUrl(raw['APP_URL'] ?? '')) {
    issues.push({
      key: 'APP_URL',
      message:
        'must not be localhost or a loopback address in production (it is the CORS default and the base of every mailed link)',
    });
  }

  // Captcha: off only when someone said so explicitly.
  const captchaDisabled = raw['CAPTCHA_DISABLED'] === 'true';
  const secret = (raw['TURNSTILE_SECRET_KEY'] ?? '').trim();
  if (!captchaDisabled && secret === '') {
    issues.push({
      key: 'TURNSTILE_SECRET_KEY',
      message: 'is required in production (or set CAPTCHA_DISABLED=true to run without a captcha)',
    });
  }
  if (!captchaDisabled && TURNSTILE_TEST_SECRET.test(secret)) {
    issues.push({
      key: 'TURNSTILE_SECRET_KEY',
      message: 'is a Cloudflare test secret, which accepts every token; use the real secret',
    });
  }
  if (captchaDisabled && secret !== '') {
    issues.push({
      key: 'CAPTCHA_DISABLED',
      message: 'is true while TURNSTILE_SECRET_KEY is set; clear one of them',
    });
  }

  // CSRF: a real secret, never one minted per boot.
  if (blank('CSRF_SECRET')) {
    issues.push({
      key: 'CSRF_SECRET',
      message: `is required in production (${CSRF_SECRET_MIN_BYTES}+ bytes, openssl rand -hex 32)`,
    });
  }

  // Secrets committed to this repo for tests and CI are public. Compared, never
  // echoed: the issue names the key only. Hex keys compare case-insensitively.
  for (const [key, known] of Object.entries(COMMITTED_TEST_SECRETS)) {
    const value = (raw[key] ?? '').trim().toLowerCase();
    if (value !== '' && known.some((entry) => entry.toLowerCase() === value)) {
      issues.push({
        key,
        message: 'is a value committed to this repo for tests or CI; generate a real one',
      });
    }
  }

  // Mail: a real relay, reached over TLS.
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) {
    if (blank(key)) issues.push({ key, message: 'is required in production' });
  }
  if (raw['SMTP_REQUIRE_TLS'] === 'false') {
    issues.push({
      key: 'SMTP_REQUIRE_TLS',
      message:
        'must be true in production: mail carries password-reset and verification links, and SMTP credentials',
    });
  }

  return issues;
}

/** The boot error text: every bad key, one per line. */
function formatIssues(issues: readonly IEnvIssue[]): string {
  return (
    `Invalid environment (${issues.length} problem${issues.length === 1 ? '' : 's'}):\n` +
    issues.map((issue) => `  - ${issue.key} ${issue.message}`).join('\n')
  );
}

function check(raw: RawEnv) {
  const result = envSchema.safeParse(raw);
  const issues: IEnvIssue[] = result.success
    ? []
    : result.error.issues.map((issue) => ({
        key: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      }));
  if (raw['NODE_ENV'] === 'production') issues.push(...productionIssues(raw));
  return { issues, result };
}

/** Every bad key in `raw`, or [] when `parseEnv` would accept it. */
export function collectEnvIssues(raw: RawEnv): IEnvIssue[] {
  return check(raw).issues;
}

export interface IParseEnvOptions {
  /** Where the dev-only warnings go. Defaults to a structured stderr line. */
  readonly warn?: (message: string) => void;
}

function defaultWarn(message: string): void {
  console.warn(JSON.stringify({ timestamp: nowIso(), level: 'warn', context: 'Env', message }));
}

/**
 * Parses `raw` (the merged .env files and process environment) into a typed
 * `Env`, or throws an `InvariantError` naming every bad key.
 */
export function parseEnv(raw: RawEnv, options: IParseEnvOptions = {}) {
  const warn = options.warn ?? defaultWarn;
  const { issues, result } = check(raw);
  // A boot-time misconfiguration is an InvariantError by the api's taxonomy.
  if (issues.length > 0 || !result.success) throw new InvariantError(formatIssues(issues));

  const env = result.data;
  const isProduction = env.NODE_ENV === 'production';

  let csrfSecret = env.CSRF_SECRET;
  if (csrfSecret === undefined) {
    // Unreachable in production (refused above). Dev and test get a fresh
    // secret per boot: tokens issued before a restart stop validating, which
    // is the whole cost.
    csrfSecret = randomBytes(CSRF_SECRET_MIN_BYTES).toString('hex');
    warn(
      'CSRF_SECRET is not set; using a random secret for this process. CSRF tokens reset on every restart. Set CSRF_SECRET (openssl rand -hex 32) to keep them.',
    );
  }

  const captchaDisabled = env.TURNSTILE_SECRET_KEY === undefined;
  if (captchaDisabled && !isProduction) {
    warn('TURNSTILE_SECRET_KEY is empty; the captcha check is off.');
  }

  return {
    ...env,
    // Production refused the unset forms of the keys below, so the dev
    // defaults (Mailpit on localhost:1025) only ever apply outside production.
    SMTP_HOST: env.SMTP_HOST ?? 'localhost',
    SMTP_PORT: env.SMTP_PORT ?? 1025,
    MAIL_FROM: env.MAIL_FROM ?? 'noreply@localhost',
    SMTP_REQUIRE_TLS: env.SMTP_REQUIRE_TLS ?? isProduction,
    CAPTCHA_DISABLED: captchaDisabled,
    CSRF_SECRET: csrfSecret,
    // The explicit list, else APP_URL's origin (a trailing slash or a path on
    // APP_URL would never equal an Origin header).
    CORS_ORIGINS: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : [new URL(env.APP_URL).origin],
  };
}

/** The validated, typed environment every consumer reads through ConfigService. */
export type Env = ReturnType<typeof parseEnv>;

/** `ConfigModule.forRoot({ validate })` adapter. */
export function validateEnv(config: Record<string, unknown>): Env {
  const raw: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(config)) {
    raw[key] = typeof value === 'string' ? value : value === undefined ? undefined : String(value);
  }
  return parseEnv(raw);
}

/** Every key the schema declares, for the `.env.example` parity spec. */
export const ENV_KEYS: readonly string[] = Object.keys(envSchema.shape);
