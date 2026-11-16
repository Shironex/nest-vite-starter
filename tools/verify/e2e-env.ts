/*
 * The one definition of the environment the e2e API boots with. CI's "Start
 * API" step and `pnpm e2e:lane` must agree down to the value, because every
 * disagreement between them shows up as "passes locally, fails in CI" in a
 * suite whose whole job is to catch that. `e2e-env.test.ts` reads the step out
 * of ci.yml and asserts the two are identical, so a value changed in one place
 * fails the build rather than a journey.
 *
 * Every value is a CI-only stand-in. The API validates its config with Joi
 * under NODE_ENV=production and fails closed without them, which is why they
 * are listed at all: the specs never exercise Turnstile, CSRF or the
 * mail transport, but the process does not start without valid-shaped values.
 */
export interface IE2eEnvInput {
  readonly apiPort: number;
  readonly webPort: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
}

/**
 * The seeded admin the specs sign in as. `apps/web/e2e/support/auth.ts` holds
 * the same literals, and the CI seed step passes them to `db:seed`.
 */
export const E2E_ADMIN = {
  email: 'admin@example.com',
  password: 'P@ssw0rd!Change.Me',
} as const;

export function e2eApiEnv(input: IE2eEnvInput): Record<string, string> {
  return {
    DATABASE_URL: input.databaseUrl,
    REDIS_URL: input.redisUrl,
    PORT: String(input.apiPort),
    NODE_ENV: 'production',
    // The SPA origin. The employer journey follows a mail link back to it, so
    // it must be the port the web app is actually served on.
    APP_URL: `http://localhost:${input.webPort}`,
    // The API's OWN public origin, distinct from APP_URL: Joi-required under
    // NODE_ENV=production so a deployment cannot mint OAuth redirect URIs
    // against localhost by accident.
    API_PUBLIC_URL: `http://localhost:${input.apiPort}`,
    SMTP_HOST: input.smtpHost,
    SMTP_PORT: String(input.smtpPort),
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    CSRF_SECRET: 'ci-e2e-csrf-secret-not-used-by-these-specs-0000',
    ENCRYPTION_KEY: '6e3dd5bc354524fb2d30c764eb2902badcb705c411870216be3234c4b33b1e81',
  };
}

/** The env CI's e2e job runs with, used by the parity test and as documentation. */
export const CI_E2E_ENV_INPUT: IE2eEnvInput = {
  apiPort: 3000,
  webPort: 5173,
  databaseUrl: 'postgresql://postgres:postgres@localhost:5432/test',
  redisUrl: 'redis://localhost:6379',
  smtpHost: 'localhost',
  smtpPort: 1025,
};
