/** @type {import('jest').Config} */
const config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Isolation specs need the live docker DB; they run only via the integration
  // lane (jest.integration.config.js / `pnpm test:integration`), never in the
  // fast self-contained suite.
  testPathIgnorePatterns: ['\\.isolation\\.spec\\.ts$'],
  // Seed required env vars (e.g. the Joi-required ENCRYPTION_KEY) before any
  // spec runs, so a boot-style spec doesn't fail the whole suite at config
  // validation. See test/setup-env.ts.
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['@swc/jest'],
  },
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!**/*.module.ts',
    '!main.ts',
    // Bootstrap side-effect module, same category as main.ts: importing it
    // IS its behavior, so covering it would mutate the suite's own
    // process.env. Its logic lives in config/load-env-files.ts, which is
    // pure and covered.
    '!load-env.ts',
    '!**/@generated/**',
    // Permanently excluded: each needs the e2e harness, is a framework
    // passthrough, or is pure config, so a unit test would only mock it.
    '!common/database/prisma.service.ts',
    // Covered by the integration isolation lane (tenant-isolation.isolation.spec.ts),
    // not the fast suite, which mocks PrismaService; same rationale as prisma.service.ts.
    '!common/database/tenant-scope.extension.ts',
    '!common/decorators/public.decorator.ts',
    '!config/configuration.config.ts',
  ],
  coverageDirectory: '../coverage',
  // json-summary writes coverage/coverage-summary.json, which the ratchet
  // (scripts/check-coverage.mjs) reads. Keep text + lcov for humans.
  coverageReporters: ['text', 'lcov', 'json-summary'],
  testEnvironment: 'node',
  /*
   * JUnit beside the human reporter, for the committed test inventory
   * (tools/verify/inventories/). Every run leaves a case list behind, so
   * `pnpm verify:inventory` can see a test that was deleted, skipped or
   * duplicated in a suite that still exits 0. The templates match the ones
   * jest.security.config.js uses, so `{file, name}` reads the same across both
   * jest lanes; `.agent-state/` is gitignored.
   */
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '<rootDir>/../../../.agent-state/inventory',
        outputName: 'api.junit.xml',
        suiteNameTemplate: '{filename}',
        classNameTemplate: '{classname}',
        titleTemplate: '{classname} > {title}',
        ancestorSeparator: ' > ',
        addFileAttribute: 'true',
        // A file that cannot even load leaves no testcase behind otherwise, and
        // "absent" is what the inventory must never read as "fine".
        reportTestSuiteErrors: 'true',
      },
    ],
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@test/(.*)$': '<rootDir>/../test/$1',
    '^@repo/shared/(.*)$': '<rootDir>/../../../packages/shared/src/$1/index.ts',
    // ESM-style relative imports inside @repo/shared (e.g. './codes.js'):
    // strip the .js so jest's resolver finds the .ts source.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

module.exports = config;
