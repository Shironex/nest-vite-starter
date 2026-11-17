import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, eslintConfigSource } from '../test-support';
import {
  checkRawSqlAllowlist,
  checkRequiredRulesAtError,
  type IRequiredRule,
} from './required-rules-at-error';

const RAW_SQL = 'noctcore-prisma/no-raw-sql-outside-allowlist';
const TABLE: readonly IRequiredRule[] = [
  { ruleId: RAW_SQL, packageDir: 'apps/api', probe: 'src/a.service.ts', rationale: 'Fixture.' },
];

describe('required-rules-at-error', () => {
  it('reports a pinned rule that was deleted from the resolved config', async () => {
    const fixture = createFixture({
      'apps/api/eslint.config.mjs': eslintConfigSource({ 'repo/other-rule': 'error' }),
    });
    const violations = await checkRequiredRulesAtError(fixture.root, TABLE);

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'required-rules-at-error');
    assert.match(violations[0]?.message ?? '', /must resolve to "error".*it is off or absent/u);
  });

  it('reports a pinned rule that was demoted to warn', async () => {
    const fixture = createFixture({
      'apps/api/eslint.config.mjs': eslintConfigSource({ [RAW_SQL]: 'warn' }),
    });
    const violations = await checkRequiredRulesAtError(fixture.root, TABLE);
    assert.match(violations[0]?.message ?? '', /it is warn/u);
  });

  it('passes a pinned rule at error, in any spelling, including with options', async () => {
    for (const entry of ['error', 2, ['error', { allowedFiles: ['x'] }]]) {
      const fixture = createFixture({
        'apps/api/eslint.config.mjs': eslintConfigSource({ [RAW_SQL]: entry }),
      });
      assert.deepEqual(await checkRequiredRulesAtError(fixture.root, TABLE), []);
    }
  });

  it('reports a pinned package that does not exist, rather than skipping it', async () => {
    const fixture = createFixture();
    const violations = await checkRequiredRulesAtError(fixture.root, TABLE);
    assert.match(violations[0]?.message ?? '', /does not exist/u);
  });

  it('fails closed when the package config cannot be resolved', async () => {
    const fixture = createFixture({
      'apps/api/eslint.config.mjs':
        "import 'this-package-does-not-exist-anywhere';\nexport default [];\n",
    });
    const violations = await checkRequiredRulesAtError(fixture.root, TABLE);
    assert.match(violations[0]?.message ?? '', /Could not resolve the effective ESLint config/u);
  });
});

describe('raw-sql-allowlist-pinned', () => {
  const config = (allowedFiles: string[]) =>
    createFixture({
      'apps/api/eslint.config.mjs': eslintConfigSource({ [RAW_SQL]: ['error', { allowedFiles }] }),
    });

  it('passes an allowlist that names only pinned globs', async () => {
    const fixture = config(['**/prisma/seed.ts']);
    assert.deepEqual(
      await checkRawSqlAllowlist(fixture.root, ['**/prisma/seed.ts', '**/x.ts']),
      [],
    );
  });

  it('reports a glob added to the ESLint allowlist but not pinned', async () => {
    const fixture = config(['**/prisma/seed.ts', 'src/modules/**']);
    const violations = await checkRawSqlAllowlist(fixture.root, ['**/prisma/seed.ts']);

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'raw-sql-allowlist-pinned');
    assert.match(violations[0]?.message ?? '', /not pinned .*: src\/modules\/\*\*/u);
  });
});
