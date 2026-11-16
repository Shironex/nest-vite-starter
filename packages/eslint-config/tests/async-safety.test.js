import asyncSafety from '@noctcore/eslint-plugin-async-safety';
import { ruleTester } from './rule-tester.js';

/*
 * Wiring check for the @noctcore/eslint-plugin-async-safety rule this repo
 * enables through @repo/eslint-config/base (default options). The repo-wide
 * `pnpm lint` is the source of truth; this pins the shapes the sites rely on:
 * a `signal` satisfies the rule, and a `...init` spread (the CSRF wrapper's
 * shape) stays silent instead of forcing a disable.
 */
ruleTester.run('require-fetch-timeout', asyncSafety.rules['require-fetch-timeout'], {
  valid: [
    { code: 'fetch(url, { signal: AbortSignal.timeout(5000) });' },
    { code: 'fetch(url, { ...init, signal: controller.signal });' },
    // Opaque option bag / spread: the rule cannot see a signal, so it stays silent.
    { code: 'fetch(url, opts);' },
    { code: 'fetch(url, { ...init, headers });' },
  ],
  invalid: [
    {
      code: "fetch('https://example.com/health');",
      errors: [
        {
          messageId: 'missingTimeout',
          suggestions: [
            {
              messageId: 'addTimeout',
              output:
                "fetch('https://example.com/health', { signal: AbortSignal.timeout(10000) });",
            },
          ],
        },
      ],
    },
    {
      code: "fetch(url, { method: 'POST' });",
      errors: [
        {
          messageId: 'missingTimeout',
          suggestions: [
            {
              messageId: 'addTimeout',
              output: "fetch(url, { signal: AbortSignal.timeout(10000), method: 'POST' });",
            },
          ],
        },
      ],
    },
  ],
});
