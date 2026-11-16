/**
 * The security lane. Runs ONLY `security-spec/*.security-spec.ts`: one file per
 * audit finding, each pinning the behavior that finding is about.
 *
 * It is a third lane, beside the fast `test` suite and the `test:integration`
 * lane, because it answers a different question. The fast suite asks "does
 * this unit behave"; the integration lane asks "does it hold against real
 * Postgres"; this lane asks "is finding X still fixed", and its results are
 * reconciled case by case against `security-spec/findings.json` by
 * `tools/quality/check-security-manifest.ts`. That reconciliation, not jest's
 * exit code, is the gate: a finding recorded as `proven` (demonstrated, not yet
 * fixed) is EXPECTED to fail, so a red jest run can be the correct outcome.
 *
 * Run it through the reconciler (`pnpm check:security` from the repo root),
 * which runs the suite for you and then compares both directions.
 *
 * Most cases need the live Postgres, and `harness.ts` throws `SPEC-INFRA`
 * rather than skipping when it is not there:
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../.env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:security
 *
 * `test:security` sets NODE_OPTIONS=--experimental-vm-modules, which jest needs
 * because the harness loads `@repo/database` through a native dynamic import()
 * (a node flag cannot be set from jest config). The config is inlined rather
 * than require()'d from jest.config.js for the reason jest.integration.config.js
 * gives: the root ESLint config forbids require() imports.
 *
 * @type {import('jest').Config}
 */
const config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/security-spec'],
  testRegex: '.*\\.security-spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['@swc/jest'],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
    '^@repo/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // The suite talks to one database and forces contention on purpose, so the
  // cases must not also contend with each other across workers.
  maxWorkers: 1,
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '<rootDir>/security-spec/.junit',
        outputName: 'security.xml',
        // The reconciler keys a case on (suite file, case name), so both have to
        // be stable and readable. `{classname}` is the describe chain, joined by
        // the separator below, and the manifest quotes exactly this string.
        suiteNameTemplate: '{filename}',
        classNameTemplate: '{classname}',
        titleTemplate: '{classname} > {title}',
        ancestorSeparator: ' > ',
        addFileAttribute: 'true',
        // A file that cannot even load (a bad import, a throwing beforeAll)
        // otherwise leaves NO testcase behind, and "absent" is the one thing
        // this lane must never read as "fine".
        reportTestSuiteErrors: 'true',
      },
    ],
  ],
};

module.exports = config;
