import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
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
 * config, and on nothing else. `architecture/colocated-test-required` looks
 * further than that: it asks whether a sibling test file exists. Delete the test
 * and the unchanged component keeps its cached "clean". So the LIST of paths
 * under src/ is digested (names, not content): adding or removing any file
 * re-lints everything, editing one does not.
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

const ruleInputsDigest = createHash('sha256')
  .update(SRC_FILES.map((file) => relative(WEB_ROOT, file)).join('\n'))
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
     * The two places autofocus is correct, scoped to exactly those files.
     *
     * `jsx-a11y/no-autofocus` exists to stop a page stealing focus on load,
     * which disorients a screen-reader user who has not asked to go anywhere.
     * None of these is that case: the two-factor challenge is a screen the user
     * was redirected to for the sole purpose of typing the code that is its only
     * control; the enrollment wizard focuses the field belonging to a step the
     * user advanced to deliberately.
     *
     * Scoped rather than disabled globally so a future autofocus on a page load
     * still fails the gate.
     */
    files: [
      'src/features/two-factor/components/TwoFactorChallenge/TwoFactorChallenge.tsx',
      'src/features/two-factor/components/EnrollWizard/EnrollWizard.tsx',
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
