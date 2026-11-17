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
import { TEST_CSRF_SECRET, TEST_ENCRYPTION_KEY } from '../src/config/committed-test-secrets';

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
  CSRF_SECRET: TEST_CSRF_SECRET,

  // A valid hex-64 (32-byte) key with high byte diversity, test-only. Clears
  // both the env.ts pattern and EncryptionService's boot-time entropy gate.
  ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
