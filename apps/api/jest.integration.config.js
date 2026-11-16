/**
 * Integration lane. Runs ONLY `*.isolation.spec.ts` against the live docker
 * Postgres (and, where a spec needs it, a real Redis): the proofs a mocked
 * Prisma cannot give, such as raw advisory locks, real argon2 bursts against
 * the lockout counters, and end-to-end flows across real rows. The fast `test` script
 * excludes these via testPathIgnorePatterns, so the default lane never touches
 * a live DB.
 *
 * Requires a real DATABASE_URL. The repo `.env` points at docker; export it
 * before running so the @repo/database singleton connects to the right DB
 * (setup-env.ts only fills DATABASE_URL when unset, so an exported value wins):
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * The `test:integration` script sets NODE_OPTIONS=--experimental-vm-modules,
 * which jest needs because the spec loads `@repo/database` via a native dynamic
 * `import()` (a node flag cannot be set from jest config). Running bare
 * `jest --config jest.integration.config.js` without that flag fails.
 *
 * The config is inlined (not require()'d from jest.config.js) because the root
 * ESLint config that lint-staged runs forbids require() imports.
 *
 * @type {import('jest').Config}
 */
const config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // Target ONLY the isolation specs the fast lane ignores.
  testRegex: '.*\\.isolation\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['@swc/jest'],
  },
  testEnvironment: 'node',
  /*
   * JUnit beside the human reporter, for the committed test inventory
   * (tools/verify/inventories/). Every run leaves a case list behind, so
   * `pnpm verify:inventory` can see a test that was deleted, skipped or
   * duplicated in a suite that still exits 0. The templates match the ones
   * jest.config.js uses, so `{file, name}` reads the same across both
   * jest lanes; `.agent-state/` is gitignored.
   */
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '<rootDir>/../../../.agent-state/inventory',
        outputName: 'isolation.junit.xml',
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
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

module.exports = config;
