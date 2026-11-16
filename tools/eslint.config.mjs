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
  {
    // The isolation canary runner is a standalone Node CLI: it boots no Nest
    // application, and it spawns the isolation lane with the mutant selector
    // and the database url in the CHILD's environment, so its own environment
    // is its input. `contracts/no-direct-process-env` points at the NestJS
    // typed config accessor, which is an impossible answer here; the same
    // reasoning the root config applies to scripts/**.
    files: ['canary/*.ts'],
    rules: {
      'contracts/no-direct-process-env': 'off',
    },
  },
  {
    /*
     * The two security-lane rule tests carry their fixtures as source STRINGS:
     * a fixture containing `it.skip(` or `xit(` is the input those rules must
     * report, not a skipped test in this file. `skipped-tests-need-tracking`
     * matches text, so it cannot tell the two apart, and an owner marker on a
     * fixture would say nothing true. Scoped to these files by name; every
     * other file under tools/ keeps the rule.
     */
    files: ['**/security-spec-*.test.ts'],
    rules: {
      'code-quality/skipped-tests-need-tracking': 'off',
    },
  },
];
