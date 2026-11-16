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
 * CI and pre-push run this through `pnpm lint:tools`; turbo does not, because
 * tools/ is not a workspace package.
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
     * tools/verify is the verification harness: it builds the child env for the
     * sandbox containers and the e2e lane from scratch and reads its own
     * switches before any application exists. `no-direct-process-env` asks for
     * a typed `@nestjs/config` accessor, and there is no Nest container here to
     * route through: this code is what starts the process that has one.
     */
    files: ['verify/**/*.ts'],
    rules: {
      'contracts/no-direct-process-env': 'off',
    },
  },
  {
    // The e2e lane probes the api and web servers it just spawned, on free
    // ports it picked itself, until they answer. The whole URL is runtime by
    // construction and no request input reaches it, so the SSRF rule has
    // nothing to protect here. Exact file: the rest of tools/verify keeps it.
    files: ['verify/e2e-runtime.ts'],
    rules: {
      'noctcore-security/no-user-controlled-fetch-url': 'off',
    },
  },
];
