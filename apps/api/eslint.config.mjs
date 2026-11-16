import { config as nestjsConfig } from '@repo/eslint-config/nestjs';
import globals from 'globals';

/*
 * There is deliberately no cached lint (`eslint --cache`, `lint:fast`) for the
 * api. ESLint keys a cached result on the linted file's content and the
 * resolved config, and on nothing else, and the api's type-aware block reads
 * OTHER files through the type checker: `mutation-entry-must-reach-audit`
 * follows calls across files from each `@Mutation()`, and
 * `no-floating-promises` depends on the return type of whatever is called.
 * Delete the audit call in a service and the unchanged router keeps a cached
 * "clean". No `settings` digest can fix that short of hashing all of src/,
 * which leaves nothing to cache. scripts/lint-cache-api-uncached.test.mjs
 * shows the stale green and fails if a cached api lint comes back.
 */

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['src/@generated/**', 'dist/**'] },
  ...nestjsConfig,
  {
    files: ['src/**/*.{ts,js}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // The security lane (security-spec/**) is test support, not served code, so
    // it gets the same env allowance apps/api/test/** already has in the shared
    // config: `harness.ts` reads DATABASE_URL and REDIS_URL to decide whether it
    // can reach the services at all, and there is no Nest ConfigService in a
    // jest harness to read them through. The specs themselves are already
    // covered by the shared `**/*.{spec,test}.ts` allowance; this is for the
    // harness and fixtures beside them.
    files: ['security-spec/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'contracts/no-direct-process-env': 'off',
    },
  },
  {
    files: ['**/*.config.{js,cjs,mjs}', '**/jest.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
];
