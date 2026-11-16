import * as Joi from 'joi';
import { PRODUCT_NAME } from '@repo/shared/constants';

/** True when Intl knows the zone, i.e. it is an IANA name (or `UTC`). */
function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const validationSchema = Joi.object({
  // Server
  PORT: Joi.number().port().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  // Database
  DATABASE_URL: Joi.string().uri().required(),
  DB_POOL_MAX: Joi.number().integer().min(1).default(10),
  DB_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(0).default(30000),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: Joi.number().integer().min(0).default(60000),

  // Redis
  REDIS_URL: Joi.string().uri().required(),

  // Express trust proxy. Loopback covers a reverse proxy on the same host.
  // For multi-hop proxies (CloudFront -> Traefik) use '2' or specific IPs.
  // See https://expressjs.com/en/guide/behind-proxies.html
  TRUST_PROXY: Joi.string().default('loopback'),

  // Logging
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),

  // App
  APP_NAME: Joi.string().default(PRODUCT_NAME),
  APP_URL: Joi.string().uri().default('http://localhost:5173'),
  // The IANA zone calendar-date math and the daily sweeps run in (see
  // common/clock/app-calendar.ts). One zone per deployment.
  APP_TIME_ZONE: Joi.string()
    .empty('')
    .default('UTC')
    .custom((value: string, helpers) =>
      isKnownTimeZone(value)
        ? value
        : helpers.message({
            custom: 'APP_TIME_ZONE must be an IANA time zone such as UTC or America/New_York',
          }),
    ),
  CORS_ORIGINS: Joi.string().optional().allow(''),

  // TOTP issuer shown in the user's authenticator app (the label before the
  // account email). Defaults to APP_NAME; override per deployment/brand.
  TOTP_ISSUER: Joi.string().optional().allow(''),

  // Email transport selection. `smtp` (nodemailer, the default) or `resend`
  // (a stub seam this phase scaffolds; not yet implemented). Swapping the
  // provider is a config change only.
  EMAIL_PROVIDER: Joi.string().valid('smtp', 'resend').default('smtp'),
  // Only consumed when EMAIL_PROVIDER=resend.
  RESEND_API_KEY: Joi.string().optional().allow(''),

  // SMTP (email)
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_USER: Joi.string().optional().allow(''),
  SMTP_PASS: Joi.string().optional().allow(''),
  SMTP_FROM: Joi.string().default('noreply@localhost'),

  // Cloudflare Turnstile: always required. Use the public test key
  // (1x0000000000000000000000000000000AA) in dev; Joi must NOT default
  // because that would silently mask a missing prod secret.
  TURNSTILE_SECRET_KEY: Joi.string().required(),

  // CSRF: always required. `openssl rand -hex 32` for prod.
  CSRF_SECRET: Joi.string().min(32).required(),

  // Encryption-at-rest master key for EncryptionService (AES-256-GCM). Always
  // required so the app fails closed at boot rather than on first encrypt.
  // Must decode to exactly 32 bytes: either base64 (44 chars, e.g.
  // `openssl rand -base64 32`) or hex (64 chars, `openssl rand -hex 32`).
  // EncryptionService re-validates length + byte-diversity at boot.
  ENCRYPTION_KEY: Joi.string()
    .pattern(/^(?:[A-Za-z0-9+/]{43}=|[0-9a-fA-F]{64})$/, 'base64-32 or hex-64')
    .required(),

  // Admin seed credentials (optional)
  ADMIN_EMAIL: Joi.string().email().optional().allow(''),
  ADMIN_PASSWORD: Joi.string().optional().allow(''),

  // AuditLog retention window for the audit-log-retention cron (GDPR storage
  // limitation). Floor of 30 days so a fat-fingered value cannot gut the
  // compliance trail overnight.
  AUDIT_LOG_RETENTION_DAYS: Joi.number().integer().min(30).default(365),

  // Grace window for the user-purge cron: soft-deleted accounts older than
  // this many days are hard-deleted. 0 means purge on the
  // next sweep; the default gives 30 days to reverse an accidental deletion.
  USER_PURGE_GRACE_DAYS: Joi.number().integer().min(0).default(30),

  // OpenTelemetry: empty endpoint disables the SDK entirely (no-op),
  // matching the default local-dev path. When set, the SDK pushes OTLP/HTTP
  // to that base URL plus /v1/traces and /v1/metrics. See apps/api/src/otel.ts.
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional().allow(''),
  OTEL_EXPORTER_OTLP_PROTOCOL: Joi.string()
    .valid('http/protobuf', 'http/json', 'grpc')
    .default('http/protobuf'),
  OTEL_SERVICE_NAME: Joi.string().optional().allow(''),

  // Sentry: runtime error capture only. Empty/unset disables Sentry entirely
  // (no-op, zero egress), matching the default local-dev path. See
  // apps/api/src/otel.ts. APP_VERSION names the release (the runner launches
  // dist/main.js directly, so npm_package_version is undefined); set it as a
  // Dockerfile build arg for a real release name, else it defaults to 0.0.0.
  // SENTRY_ENVIRONMENT overrides the NODE_ENV-derived environment tag.
  SENTRY_DSN: Joi.string().uri().optional().allow(''),
  SENTRY_ENVIRONMENT: Joi.string().optional().allow(''),
  APP_VERSION: Joi.string().optional().allow(''),
});
