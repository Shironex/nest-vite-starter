import { config as baseConfig } from '@repo/eslint-config/base';
import globals from 'globals';

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    // Scope note: as of ESLint 10, config lookup starts at each linted file's
    // own directory rather than the working directory. Every app and package
    // that ships its own eslint.config.* therefore resolves that file, not this
    // one, no matter where eslint is invoked from. What this config actually
    // governs is the rest of the tree: root-level files, scripts/, and the
    // eslint-authoring package (packages/eslint-config), which has no local
    // config of its own.
    // tools/ resolves its own tools/eslint.config.mjs (base policy plus
    // noInlineConfig), linted by `pnpm lint:tools`.
    // That now holds for lint-staged too, which used to resolve this config for
    // every staged file because it runs from the repo root.
    ignores: ['**/src/@generated/**', '**/dist/**', '**/node_modules/**'],
  },
  ...baseConfig,
  {
    // Public static assets in apps/web are vanilla browser scripts (no
    // module bundling). apps/web/eslint.config.js carries the same block and is
    // what these files resolve now, so this one only covers a root-level
    // `eslint .` run. Keep the two in step.
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    // Repo tooling in scripts/ are standalone Node CLIs: they are invoked by
    // package scripts and CI steps, never bundled and never imported by an app.
    // They legitimately use console / process.argv / process.env / process.exit,
    // which the application globals do not define. They only need the right environment.
    files: ['scripts/**/*.{mjs,js}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // `no-direct-process-env` points at the NestJS typed config accessor,
      // which is the right answer inside apps/api and an impossible one in a
      // process that boots no Nest application. A CLI's environment IS its
      // input.
      'contracts/no-direct-process-env': 'off',
    },
  },
  {
    // CommonJS config files (jest.config.js, *.config.cjs, etc.) give them
    // node globals + commonjs source type. This reaches the ones outside a
    // package that has its own config; inside such a package the local config
    // is what resolves, per the scope note above.
    files: ['**/*.config.{js,cjs}', '**/jest.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
];
