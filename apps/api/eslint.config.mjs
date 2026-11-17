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
 * which leaves nothing to cache.
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
    files: ['**/*.config.{js,cjs,mjs}', '**/jest.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
];
