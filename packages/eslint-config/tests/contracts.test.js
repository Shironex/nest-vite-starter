import contracts from '@noctcore/eslint-plugin-contracts';
import { ruleTester } from './rule-tester.js';

/*
 * Wiring check for @noctcore/eslint-plugin-contracts/no-direct-process-env as
 * enabled through @repo/eslint-config/base. Options mirror base.js. The critical
 * assertion is that the `**\/`-anchored allowlist still exempts the pre-DI /
 * out-of-Nest files when matched against an absolute filename, since the noctcore
 * matcher runs on the raw filename rather than the repo-relative path the deleted
 * local rule used. Also pins the superset: bare `process.env` pass-through (not
 * just `process.env.X`) is caught by the single MemberExpression visitor.
 */
const NO_DIRECT_PROCESS_ENV_ALLOWED_FILES = [
  '**/otel.ts',
  '**/packages/shared/src/logger/**',
  '**/apps/api/src/modules/logger/logger.service.ts',
  '**/apps/api/src/common/observability/sentry-scrub.ts',
  '**/apps/api/test/**',
  '**/packages/database/**',
  '**/apps/desktop/**',
  '**/*.config.{ts,js,mjs,cjs}',
  '**/playwright.config.ts',
  '**/*.{spec,test}.{ts,tsx}',
];

const options = [
  { configModule: '@nestjs/config', allowedFiles: NO_DIRECT_PROCESS_ENV_ALLOWED_FILES },
];

ruleTester.run('no-direct-process-env', contracts.rules['no-direct-process-env'], {
  valid: [
    {
      code: 'const url = process.env.APP_URL;',
      filename: '/repo/apps/desktop/electron/main.ts',
      options,
    },
    {
      code: 'const db = process.env.DATABASE_URL;',
      filename: '/repo/packages/database/prisma/seed.ts',
      options,
    },
    {
      code: 'const key = process.env.TEST_KEY;',
      filename: '/repo/apps/api/test/setup-env.ts',
      options,
    },
    {
      code: 'const env = process.env.NODE_ENV;',
      filename: '/repo/apps/api/src/modules/logger/logger.service.ts',
      options,
    },
  ],
  invalid: [
    {
      code: 'const url = process.env.APP_URL;',
      filename: '/repo/apps/api/src/modules/billing/billing.service.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
    // Superset over the deleted local rule: bare pass-through is caught.
    {
      code: 'log(process.env);',
      filename: '/repo/apps/api/src/modules/billing/billing.service.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
  ],
});
