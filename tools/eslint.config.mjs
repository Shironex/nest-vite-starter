import { config as baseConfig } from '@repo/eslint-config/base';

/*
 * Repo tooling is product code: lint-meta rules are the guardrails every other
 * check trusts, so a suppression comment in them is a hole in the gate. This
 * config is what a file under tools/ resolves (ESLint looks up the nearest
 * config), so it re-uses the root base policy and adds the one thing that
 * policy cannot say for tools alone: inline `eslint-disable` and config
 * comments are ignored, never honored. A scoped override here is the only
 * way to relax a rule for a path.
 *
 * The verify lint lane runs this through `pnpm lint:tools`; turbo does not,
 * because tools/ is not a workspace package.
 */

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    linterOptions: {
      noInlineConfig: true,
    },
  },
  {
    /*
     * tools/verify passes its own environment to the commands it runs, before
     * any application exists. `no-direct-process-env` asks for a typed
     * `@nestjs/config` accessor, and there is no Nest container here.
     */
    files: ['verify/**/*.ts'],
    rules: {
      'contracts/no-direct-process-env': 'off',
    },
  },
];
