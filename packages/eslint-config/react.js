import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import { config as baseConfig } from './base.js';

/** @type {import("eslint").Linter.Config[]} */
export const config = [
  ...baseConfig,
  reactHooksPlugin.configs.flat['recommended-latest'],
  {
    plugins: {
      react: reactPlugin,
    },
    settings: {
      /*
       * Pinned rather than 'detect'. eslint-plugin-react 7.37.5 is the latest
       * published release and its version-detection path (util/version.js
       * resolveBasedir) still calls the `context.getFilename()` method ESLint 10
       * removed, so 'detect' throws a TypeError while loading every rule that
       * consults the React version. Passing an explicit version never enters
       * that path. Keep this in step with the react dependency in apps/web and
       * packages/ui; revert to 'detect' once eslint-plugin-react ships an
       * ESLint 10 compatible release.
       */
      react: { version: '19.2' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
    },
  },
  /*
   * Accessibility. Until this landed the repo had no a11y linting of any kind:
   * no jsx-a11y, no axe, nothing. Every other category a static analyser looks
   * at here is already covered by the rules above, by @noctcore/*, by knip or by
   * the bundle budget, so this was the one real blind spot.
   *
   * The flat `recommended` preset is used as published: 34 rules, 31 at 'error'
   * and 3 deliberately 'off', with no 'warn' anywhere, so it satisfies the
   * repo's error-or-off policy without an override block. `strict` was
   * considered and rejected for now: recommended is the set whose violations are
   * defects a user actually hits, and a gate nobody can keep green teaches
   * people to disable it.
   */
  jsxA11yPlugin.flatConfigs.recommended,
  {
    // The react-hooks `recommended-latest` preset (spread above) ships three
    // rules at 'warn', which violates the repo's error-or-off-never-warn policy.
    // Override the effective severity here so the resolved config is compliant.
    // Enforced by lint:meta's eslint-config-no-warn, which evaluates the RESOLVED
    // flat config (not a text grep), so a preset-injected 'warn' fails the gate.
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/unsupported-syntax': 'error',
      // 'off', not 'error': incompatible-library fires on react-hook-form's
      // form.watch(), which the React Compiler cannot memoize. It is a known
      // false-positive class for our stack (not a real bug), so disable it
      // rather than restructure every form.
      'react-hooks/incompatible-library': 'off',
    },
  },
];
