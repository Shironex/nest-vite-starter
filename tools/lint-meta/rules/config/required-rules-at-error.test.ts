import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, eslintConfigSource, runAsync } from '../../test-support';
import { requiredRulesAtErrorRule } from './required-rules-at-error';

/*
 * The rule pins a fixed table of rule ids per package. These tests drive one
 * entry of that table (the raw SQL rule, apps/api) and filter the result to
 * it, so adding another required rule to the table does not break them.
 */
const PINNED = 'noctcore-prisma/no-raw-sql-outside-allowlist';

async function pinnedViolations(files: Record<string, string>) {
  const fixture = createFixture(files);
  const violations = await runAsync(requiredRulesAtErrorRule, fixture.context());
  return violations.filter((violation) => violation.message.includes(`"${PINNED}"`));
}

describe('required-rules-at-error', () => {
  it('reports a pinned rule that was deleted from the resolved config', async () => {
    const violations = await pinnedViolations({
      'apps/api/eslint.config.mjs': eslintConfigSource({ 'repo/other-rule': 'error' }),
    });

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'required-rules-at-error');
    assert.match(violations[0]?.message ?? '', /must resolve to "error"/u);
    assert.match(violations[0]?.message ?? '', /it is off or absent/u);
  });

  it('reports a pinned rule that was demoted to off or to warn', async () => {
    const off = await pinnedViolations({
      'apps/api/eslint.config.mjs': eslintConfigSource({ [PINNED]: 'off' }),
    });
    const warn = await pinnedViolations({
      'apps/api/eslint.config.mjs': eslintConfigSource({ [PINNED]: 'warn' }),
    });

    assert.match(off[0]?.message ?? '', /it is off or absent/u);
    assert.match(warn[0]?.message ?? '', /it is warn/u);
  });

  it('passes a pinned rule at error, in any spelling, including with options', async () => {
    for (const entry of ['error', 2, ['error', { allow: ['x'] }]]) {
      const violations = await pinnedViolations({
        'apps/api/eslint.config.mjs': eslintConfigSource({ [PINNED]: entry }),
      });
      assert.deepEqual(violations, []);
    }
  });

  it('reports every pinned rule when the package config drops them all', async () => {
    const fixture = createFixture({
      'apps/api/eslint.config.mjs': eslintConfigSource({ 'repo/unrelated': 'error' }),
    });

    const violations = await runAsync(requiredRulesAtErrorRule, fixture.context());

    // At least the three apps/api pins; the web pins report a missing package.
    assert.ok(violations.filter((violation) => violation.file.startsWith('apps/api')).length >= 3);
  });

  it('reports a pinned package that does not exist, rather than skipping it', async () => {
    const fixture = createFixture();

    const violations = await runAsync(requiredRulesAtErrorRule, fixture.context());

    assert.ok(violations.length > 0);
    assert.ok(violations.every((violation) => /does not exist/u.test(violation.message)));
  });

  it('fails closed when the package config cannot be resolved', async () => {
    const fixture = createFixture({
      'apps/api/eslint.config.mjs':
        "import 'this-package-does-not-exist-anywhere';\nexport default [];\n",
    });

    const violations = await runAsync(requiredRulesAtErrorRule, fixture.context());
    const unresolved = violations.filter((violation) =>
      /Could not resolve the effective ESLint config/u.test(violation.message),
    );

    assert.ok(unresolved.length > 0);
  });
});
