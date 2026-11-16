import astro from 'eslint-plugin-astro';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import { config as baseConfig } from '@repo/eslint-config/base';

// App-local config on purpose: docs is an Astro site, not a React feature-folder
// app, so it uses eslint-plugin-astro and deliberately does NOT extend
// @repo/eslint-config/react-architecture (those rules assume apps/web's layout).

// Plain script files in this package. `.astro` is deliberately absent: the base
// config below must not reach those.
const SCRIPT_FILES = ['**/*.{js,mjs,cjs,ts,mts,cts}'];

/*
 * The repo-wide base rules, restricted to the script files above.
 *
 * Scoping is load-bearing rather than tidiness. Several base blocks carry no
 * `files` key of their own, and one of them (typescript-eslint's base block)
 * sets a parser. Spread unscoped, that block matches `.astro` too and displaces
 * the astro parser those files need, so every `.astro` file fails to parse.
 * Blocks that already declare their own `files` are left alone, and the global
 * ignores block stays global (adding `files` to it would demote it to a
 * scoped ignore and stop it applying repo-wide).
 *
 * ESLint 10 made config lookup start from each linted file's own directory
 * instead of the working directory, so this local config is now what lint-staged
 * resolves for staged files in this package. Without the base rules here, the
 * repo-wide code-quality and contracts rules would silently stop applying at
 * commit time, which is the one place they currently run for this package.
 */
const baseForScripts = baseConfig.map((entry) => {
  if (entry.files) return entry;
  if (entry.ignores) return entry;
  return { ...entry, files: SCRIPT_FILES };
});

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['dist/**', '.astro/**', 'node_modules/**'] },
  ...astro.configs.recommended,
  // The frontmatter of an `.astro` file is TypeScript. astro-eslint-parser only
  // finds a TS parser when one happens to be hoisted next to it, which depends on
  // how pnpm lays out the store, so name it explicitly.
  {
    files: ['**/*.astro'],
    languageOptions: { parserOptions: { parser: tsParser } },
  },
  ...baseForScripts,
  {
    files: SCRIPT_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
