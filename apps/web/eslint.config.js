import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { config as reactConfig } from '@repo/eslint-config/react';
import { config as reactArchitectureConfig } from '@repo/eslint-config/react-architecture';
import globals from 'globals';

const WEB_ROOT = import.meta.dirname;

/*
 * What the web's rules read BESIDES the file being linted, folded into
 * `settings` so that `lint:fast` (eslint --cache) re-lints when it changes.
 *
 * ESLint keys a cached result on the linted file's content and the resolved
 * config, and on nothing else. Two rules here look further than that:
 *
 * - `contracts/translation-key-exists` reads the English catalogs. Delete a key
 *   and every unchanged component still using it would keep a cached "clean".
 *   So the catalogs' CONTENT is digested.
 * - `architecture/colocated-test-required` asks whether a sibling test file
 *   exists. Delete the test and the unchanged component keeps its cached
 *   "clean". So the LIST of paths under src/ is digested (names, not content):
 *   adding or removing any file re-lints everything, editing one does not.
 *
 * Not conditional on `--cache`: a `settings` value that only exists in one
 * invocation mode would be a second config to reason about.
 */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) =>
      entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
    );
}

const SRC_FILES = listFiles(join(WEB_ROOT, 'src'));
const CATALOG_FILES = SRC_FILES.filter((file) => /[/\\]locales[/\\]en\.json$/.test(file));

const ruleInputsDigest = createHash('sha256')
  .update(SRC_FILES.map((file) => relative(WEB_ROOT, file)).join('\n'))
  .update(CATALOG_FILES.map((file) => readFileSync(file)).join('\0'))
  .digest('hex');

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['src/routeTree.gen.ts', 'dist/**'] },
  ...reactConfig,
  ...reactArchitectureConfig,
  {
    // No `files`: it has to reach every linted file. See ruleInputsDigest.
    settings: {
      starterRuleInputs: ruleInputsDigest,
    },
  },
  {
    /*
     * The three places autofocus is correct, scoped to exactly those files.
     *
     * `jsx-a11y/no-autofocus` exists to stop a page stealing focus on load,
     * which disorients a screen-reader user who has not asked to go anywhere.
     * None of these is that case: the two-factor challenge is a screen the user
     * was redirected to for the sole purpose of typing the code that is its only
     * control; the enrollment wizard focuses the field belonging to a step the
     * user advanced to deliberately; and the workspace dialog opts in per field and
     * only ever on the first field of a modal the user just opened, which is the
     * documented ARIA practice for dialogs.
     *
     * Scoped rather than disabled globally so a future autofocus on a page load
     * still fails the gate.
     */
    files: [
      'src/features/two-factor/components/TwoFactorChallenge/TwoFactorChallenge.tsx',
      'src/features/two-factor/components/EnrollWizard/EnrollWizard.tsx',
      'src/features/workspace/components/WorkspaceFormDialog/WorkspaceFormDialog.tsx',
    ],
    rules: {
      'jsx-a11y/no-autofocus': 'off',
    },
  },
  {
    // `fetchWithCsrfRetry` is a forwarding wrapper: it receives a URL its
    // caller built (the tRPC links from `TRPC_URL`) and cannot see where it
    // came from. The
    // rule is purely syntactic, so every forward reads as a runtime URL.
    files: ['src/lib/csrf.ts'],
    rules: {
      'noctcore-security/no-user-controlled-fetch-url': 'off',
    },
  },
  {
    // The '@api' Vite alias points at ../api/src and exists ONLY so the tRPC
    // client can `import type { AppRouter }`. A value import would pull NestJS
    // server code (and its node-only dependency graph) into the browser bundle.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@api/*'],
              allowTypeImports: true,
              message:
                'Server code must not be value-imported into the web bundle; the "@api" alias is for `import type { AppRouter }` only.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Every static translation key must resolve in the English catalog of the
     * namespace in scope. i18next does not fail on a missing key: it renders the
     * key itself, which only a person reading the screen notices.
     *
     * The layout mirrors src/lib/i18n/index.ts: `common` and `errors` are the
     * top-level keys of the shared catalog, every feature namespace is
     * `features/<ns>/locales/en.json`, and `useTranslation()` resolves to
     * `common`. English is the reference language because it is the only one
     * the app ships (a second language would be checked for key parity
     * against it, not here). The `*_NS`
     * constants are imported, so the rule is told what each one holds.
     *
     * Paths are absolute: the rule resolves relative ones against ESLint's
     * working directory, which is apps/web under turbo but the repo root under
     * lint-staged and the editor hook.
     *
     * Tests are excluded: i18n.test.ts registers a namespace at runtime that has
     * no catalog on purpose.
     */
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'contracts/translation-key-exists': [
        'error',
        {
          catalogs: [
            { file: join(WEB_ROOT, 'src/lib/i18n/locales/en.json'), keyPath: '{ns}' },
            { file: join(WEB_ROOT, 'src/features/{ns}/locales/en.json') },
          ],
          defaultNamespace: 'common',
          namespaceIdentifiers: {
            AUDIT_NS: 'audit',
            AUTH_NS: 'auth',
            DASHBOARD_NS: 'dashboard',
            WORKSPACE_NS: 'workspace',
          },
        },
      ],
    },
  },
  {
    // Public static assets are vanilla browser scripts (no module bundling).
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
  },
];
