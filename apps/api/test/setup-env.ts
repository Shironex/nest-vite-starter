/**
 * Jest setupFiles hook: seed env vars that the ConfigModule Joi schema marks
 * `required()`, so any spec that boots the real ConfigModule / AppModule (now
 * or in the future) clears config validation instead of aborting the whole
 * suite. ENCRYPTION_KEY is `required()` in configuration.config.ts, so without
 * a valid key here a single boot-style spec would fail the entire api run at
 * config validation.
 *
 * The full set below mirrors every `.required()` field in
 * configuration.config.ts so app.module.spec.ts can boot the real AppModule's
 * ConfigModule.forRoot validation. Values are valid-format-only test stand-ins
 * (the URIs never get dialed at compile time): the spec only resolves the DI
 * graph, it never opens a real DB / Redis connection.
 *
 * Only fills values that are unset, so a value provided by the surrounding
 * shell / CI env always wins.
 */
const TEST_ENV_DEFAULTS: Record<string, string> = {
  // Joi `.uri()` on DATABASE_URL / REDIS_URL, so a valid scheme is
  // mandatory. These hosts are never connected to here; the AppModule spec
  // overrides every infra provider that would otherwise dial them.
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',

  // SMTP_HOST is required (no Joi default); the transport is never constructed.
  SMTP_HOST: 'localhost',

  // Cloudflare Turnstile secret: required, no default. The public test value.
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',

  // CSRF_SECRET is required with Joi `.min(32)`, so this must be >= 32 chars.
  CSRF_SECRET: 'test-csrf-secret-test-csrf-secret-0123456789',

  // A valid hex-64 (32-byte) key with high byte diversity, test-only. Clears
  // both the Joi pattern and EncryptionService's boot-time entropy gate.
  ENCRYPTION_KEY: '6e3dd5bc354524fb2d30c764eb2902badcb705c411870216be3234c4b33b1e81',
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
