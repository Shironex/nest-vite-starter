/**
 * Secret values committed to this public repo for tests and CI. Anyone can read
 * them, so `parseEnv` refuses every one of them in production (env.ts).
 *
 * The test setup and specs import these constants instead of repeating the
 * literals. `.github/workflows/ci.yml` cannot import, so it carries copies of
 * TEST_ENCRYPTION_KEY and CI_E2E_CSRF_SECRET; change them together. The two
 * long literals are exempted from gitleaks by exact value in `.gitleaks.toml`.
 */

/** test/setup-env.ts and ci.yml: a valid hex-64 key with high byte diversity. */
export const TEST_ENCRYPTION_KEY =
  '6e3dd5bc354524fb2d30c764eb2902badcb705c411870216be3234c4b33b1e81';

/** test/setup-env.ts: clears the 32-byte minimum when a spec boots the real ConfigModule. */
export const TEST_CSRF_SECRET = 'test-csrf-secret-test-csrf-secret-0123456789';

/** test/test-module.ts: the config mock's value (too short for the schema anyway). */
export const TEST_MODULE_CSRF_SECRET = 'test-csrf-secret';

/** csrf.service.spec.ts. */
export const CSRF_SERVICE_SPEC_SECRET = 'super-long-secret-for-csrf-tests-123456';

/** ci.yml's e2e job (`CSRF_SECRET`). */
export const CI_E2E_CSRF_SECRET = 'ci-e2e-csrf-secret-not-used-by-these-specs-0000';

/** Every committed value per key, for the production refusal in env.ts. */
export const COMMITTED_TEST_SECRETS: Readonly<Record<string, readonly string[]>> = {
  CSRF_SECRET: [
    TEST_CSRF_SECRET,
    TEST_MODULE_CSRF_SECRET,
    CSRF_SERVICE_SPEC_SECRET,
    CI_E2E_CSRF_SECRET,
  ],
  ENCRYPTION_KEY: [TEST_ENCRYPTION_KEY],
};
