import codeQuality from '@noctcore/eslint-plugin-code-quality';
import { ruleTester } from './rule-tester.js';

/*
 * Wiring checks for the @noctcore/eslint-plugin-code-quality rules this repo
 * enables through @repo/eslint-config/base. Option objects mirror base.js; the
 * repo-wide `pnpm lint` diff is the source of truth, these pin the behavior
 * that differs from the deleted local rules (no-focused-tests now resolves
 * chained modifiers; no-process-exit matches allowlist globs against the raw
 * absolute filename, so the anchored `**\/` prefixes must still exempt the
 * bootstrap/CLI dirs).
 */
const NO_PROCESS_EXIT_ALLOW_IN = [
  '**/otel.ts',
  '**/apps/api/src/main.ts',
  '**/apps/desktop/**',
  '**/packages/database/**',
  '**/tools/**',
  '**/scripts/**',
  '**/*.config.{ts,js,mjs,cjs}',
];

ruleTester.run('no-focused-tests', codeQuality.rules['no-focused-tests'], {
  valid: [
    { code: 'it("runs", () => {});' },
    { code: 'describe("suite", () => {});' },
    { code: 'test.concurrent("runs", () => {});' },
  ],
  invalid: [
    { code: 'it.only("x", () => {});', errors: [{ messageId: 'focused' }] },
    { code: 'describe.only("x", () => {});', errors: [{ messageId: 'focused' }] },
    // Superset over the deleted local rule: chained modifiers resolve to the
    // root runner, so `test.concurrent.only` is caught.
    { code: 'test.concurrent.only("x", () => {});', errors: [{ messageId: 'focused' }] },
    { code: 'fdescribe("x", () => {});', errors: [{ messageId: 'focusedCall' }] },
  ],
});

const allowExitOptions = [{ allowIn: NO_PROCESS_EXIT_ALLOW_IN }];

ruleTester.run('no-process-exit', codeQuality.rules['no-process-exit'], {
  valid: [
    // Absolute paths: the `**\/`-anchored allowlist globs must still exempt these
    // bootstrap/CLI directories (the pre-swap local rule matched a repo-relative
    // path, so the prefixes are what preserve that behavior here).
    {
      code: 'process.exit(1);',
      filename: '/repo/apps/desktop/electron/main.ts',
      options: allowExitOptions,
    },
    {
      code: 'process.exit(0);',
      filename: '/repo/packages/database/prisma/seed.ts',
      options: allowExitOptions,
    },
    {
      code: 'process.exit(1);',
      filename: '/repo/tools/lint-meta/cli.ts',
      options: allowExitOptions,
    },
    {
      code: 'process.exit(0);',
      filename: '/repo/apps/api/src/otel.ts',
      options: allowExitOptions,
    },
  ],
  invalid: [
    {
      code: 'process.exit(1);',
      filename: '/repo/apps/api/src/modules/billing/billing.service.ts',
      options: allowExitOptions,
      errors: [{ messageId: 'processExit' }],
    },
  ],
});
