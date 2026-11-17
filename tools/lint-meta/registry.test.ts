import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { META_RULES } from './registry';

describe('lint-meta registry', () => {
  it('has unique rule ids', () => {
    const ids = META_RULES.map((rule) => rule.id);
    assert.deepEqual(ids, [...new Set(ids)]);
  });

  it('makes every rule required: each one fails the build', () => {
    for (const rule of META_RULES) {
      assert.equal(rule.ciCritical, true, rule.id);
      assert.ok(rule.run !== undefined || rule.runAsync !== undefined, rule.id);
    }
  });

  it('keeps the list short', () => {
    assert.ok(META_RULES.length <= 15, `${String(META_RULES.length)} rules`);
  });
});
