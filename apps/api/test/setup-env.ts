/**
 * Jest setupFiles hook: seed the env vars the api's env schema
 * (src/config/env.ts) requires, so any spec that boots the real ConfigModule /
 * AppModule clears config validation instead of aborting the whole suite.
 *
 * The set below mirrors every required key in env.ts (NODE_ENV comes from
 * jest itself, as `test`) so app.module.spec.ts can boot the real AppModule's
 * ConfigModule.forRoot validation. Values are valid-format-only test stand-ins
 * (the URIs never get dialed at compile time): the spec only resolves the DI
 * graph, it never opens a real DB / Redis connection.
 *
 * Only fills values that are unset, so a value provided by the surrounding
 * shell / CI env always wins.
 */
const TEST_ENV_DEFAULTS: Record<string, string> = {
  // DATABASE_URL / REDIS_URL must parse with a postgres / redis scheme. These hosts are never connected to here; the AppModule spec
  // overrides every infra provider that would otherwise dial them.
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',

  // The web origin; required in every environment.
  APP_URL: 'http://localhost:5173',

  // SMTP_HOST has a dev default; set explicitly so specs never depend on it.
  SMTP_HOST: 'localhost',

  // Cloudflare Turnstile secret: the public always-pass test value.
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',

  // Set so specs do not mint a random one; must be >= 32 bytes.
  CSRF_SECRET: 'test-csrf-secret-test-csrf-secret-0123456789',

  // A valid hex-64 (32-byte) key with high byte diversity, test-only. Clears
  // both the env.ts pattern and EncryptionService's boot-time entropy gate.
  ENCRYPTION_KEY: '6e3dd5bc354524fb2d30c764eb2902badcb705c411870216be3234c4b33b1e81',
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
