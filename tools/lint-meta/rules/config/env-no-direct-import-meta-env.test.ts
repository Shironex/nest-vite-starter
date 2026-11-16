import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import {
  checkEnvNoDirectImportMetaEnv,
  ENV_MODULE,
  envNoDirectImportMetaEnvRule,
} from './env-no-direct-import-meta-env';

const FEATURE = 'apps/web/src/features/auth/Field.hooks.ts';

describe('env-no-direct-import-meta-env', () => {
  it('reports a VITE_ key read outside the env module, naming the key and the line', () => {
    const fixture = createFixture({
      [FEATURE]: [
        'export function useField() {',
        '  return import.meta.env.VITE_SENTRY_DSN;',
        '}',
        '',
      ].join('\n'),
    });

    const violations = runSync(envNoDirectImportMetaEnvRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'env-no-direct-import-meta-env');
    assert.equal(violations[0]?.file, FEATURE);
    assert.match(violations[0]?.message ?? '', /^Line 2: `VITE_SENTRY_DSN` is read directly\./u);
  });

  it('lets the env module itself read the keys it owns', () => {
    const fixture = createFixture({
      [ENV_MODULE]: "export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN ?? '';\n",
    });

    assert.deepEqual(checkEnvNoDirectImportMetaEnv(fixture.context()), []);
  });

  it('leaves DEV, PROD and MODE inline, because Vite eliminates those branches', () => {
    const fixture = createFixture({
      [FEATURE]: [
        'if (import.meta.env.DEV) log();',
        'if (import.meta.env.PROD) report();',
        'const mode = import.meta.env.MODE;',
        '',
      ].join('\n'),
    });

    assert.deepEqual(checkEnvNoDirectImportMetaEnv(fixture.context()), []);
  });

  it('accepts an import of the env module instead of a direct read', () => {
    const fixture = createFixture({
      [FEATURE]: "import { SENTRY_DSN } from '@/lib/env';\nexport const dsn = SENTRY_DSN;\n",
    });

    assert.deepEqual(checkEnvNoDirectImportMetaEnv(fixture.context()), []);
  });

  it('looks at the web app only: the api and the packages have no import.meta.env', () => {
    const fixture = createFixture({
      'apps/api/src/config/a.ts': 'export const x = import.meta.env.VITE_SENTRY_DSN;\n',
      'packages/ui/src/a.ts': 'export const y = import.meta.env.VITE_SENTRY_DSN;\n',
    });

    assert.deepEqual(checkEnvNoDirectImportMetaEnv(fixture.context()), []);
  });

  it('is dormant on a tree with no web source', () => {
    assert.deepEqual(checkEnvNoDirectImportMetaEnv(createFixture().context()), []);
  });
});
