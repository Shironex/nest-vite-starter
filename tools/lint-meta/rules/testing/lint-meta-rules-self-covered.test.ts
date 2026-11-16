import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import {
  checkLintMetaRulesSelfCovered,
  lintMetaRulesSelfCoveredRule,
} from './lint-meta-rules-self-covered';

const RULES = 'tools/lint-meta/rules';

/** Fixture sources are written indented for readability; the rule reads top-level describes at column 0. */
function flat(source: string): string {
  return source.replace(/^\s+/gmu, '');
}

function flatFixture(files: Readonly<Record<string, string>> = {}) {
  return createFixture(
    Object.fromEntries(Object.entries(files).map(([path, source]) => [path, flat(source)])),
  );
}

const RULE_MODULE = `
  import type { IMetaRule } from '../../types';
  export const fooRule: IMetaRule = {
    id: 'foo-rule',
    category: 'config',
    description: 'Foo.',
    run: () => [],
  };
`;

const COVERING_TEST = `
  describe('foo-rule', () => {
    it('reports the bad fixture', () => {
      assert.equal(violations[0]?.rule, 'foo-rule');
    });
    it('passes the clean fixture', () => {
      assert.deepEqual(violations, []);
    });
  });
`;

describe('lint-meta-rules-self-covered', () => {
  it('reports a rule module with no sibling test', () => {
    const fixture = flatFixture({ [`${RULES}/config/foo-rule.ts`]: RULE_MODULE });

    const violations = runSync(lintMetaRulesSelfCoveredRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'lint-meta-rules-self-covered');
    assert.equal(violations[0]?.file, `${RULES}/config/foo-rule.ts`);
    assert.match(
      violations[0]?.message ?? '',
      /no sibling test\. Add `tools\/lint-meta\/rules\/config\/foo-rule\.test\.ts`/u,
    );
  });

  it('reports an uncovered rule module under tools/starter, not only under rules/', () => {
    const fixture = flatFixture({ 'tools/starter/foo-rule.ts': RULE_MODULE });

    const violations = runSync(lintMetaRulesSelfCoveredRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.file, 'tools/starter/foo-rule.ts');
  });

  it('passes a rule with a sibling test that covers a violation', () => {
    const fixture = flatFixture({
      [`${RULES}/config/foo-rule.ts`]: RULE_MODULE,
      [`${RULES}/config/foo-rule.test.ts`]: COVERING_TEST,
    });

    assert.deepEqual(checkLintMetaRulesSelfCovered(fixture.root), []);
  });

  it('does not accept a sibling test in a different directory', () => {
    const fixture = flatFixture({
      [`${RULES}/config/foo-rule.ts`]: RULE_MODULE,
      [`${RULES}/ci/foo-rule.test.ts`]: COVERING_TEST,
    });

    assert.equal(checkLintMetaRulesSelfCovered(fixture.root).length, 1);
  });

  it('reports a test that never names the rule id', () => {
    const fixture = flatFixture({
      [`${RULES}/config/foo-rule.ts`]: RULE_MODULE,
      [`${RULES}/config/foo-rule.test.ts`]: COVERING_TEST.replace(/foo-rule/gu, 'some-other-rule'),
    });

    const violations = checkLintMetaRulesSelfCovered(fixture.root);

    assert.equal(violations.length, 1);
    assert.match(
      violations[0]?.message ?? '',
      /no top-level `describe\('foo-rule', \.\.\.\)` block/u,
    );
  });

  it('reports a test that only ever asserts the clean path', () => {
    const fixture = flatFixture({
      [`${RULES}/config/foo-rule.ts`]: RULE_MODULE,
      [`${RULES}/config/foo-rule.test.ts`]: `
        describe('foo-rule', () => {
          it('passes the clean fixture', () => {
            assert.deepEqual(runSync(rule, ctx), []);
          });
        });
      `,
    });

    const violations = checkLintMetaRulesSelfCovered(fixture.root);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /never expects a violation/u);
  });

  it('accepts a positive length assertion as expecting a violation', () => {
    const fixture = flatFixture({
      [`${RULES}/config/foo-rule.ts`]: RULE_MODULE,
      [`${RULES}/config/foo-rule.test.ts`]: `
        describe('foo-rule', () => {
          it('reports it', () => {
            assert.equal(violations.length, 2);
          });
        });
      `,
    });

    assert.deepEqual(checkLintMetaRulesSelfCovered(fixture.root), []);
  });

  it('requires a covering block per id when one module declares two rules', () => {
    const twoRules = `
      export const a: IMetaRule = { id: 'rule-a', category: 'config', description: 'A.' };
      export const b: IMetaRule = { id: 'rule-b', category: 'config', description: 'B.' };
    `;
    const fixture = flatFixture({
      [`${RULES}/config/pair.ts`]: twoRules,
      // rule-a is covered; rule-b's block only asserts the clean path, and must not
      // borrow rule-a's violation assertion just because it shares a file.
      [`${RULES}/config/pair.test.ts`]: `
        describe('rule-a', () => {
          it('reports', () => { assert.equal(v[0]?.rule, 'rule-a'); });
        });
        describe('rule-b', () => {
          it('is quiet', () => { assert.deepEqual(v, []); });
        });
      `,
    });

    const violations = checkLintMetaRulesSelfCovered(fixture.root);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /describe\('rule-b'/u);
  });

  it('resolves an id declared through a RULE_ID constant', () => {
    const fixture = flatFixture({
      [`${RULES}/ci/bar-rule.ts`]: `
        const RULE_ID = 'bar-rule';
        export const barRule: IMetaRule = { id: RULE_ID, category: 'ci', description: 'Bar.' };
      `,
      [`${RULES}/ci/bar-rule.test.ts`]:
        "describe('bar-rule', () => { it('x', () => { a.rule; }); });\n",
    });

    assert.deepEqual(checkLintMetaRulesSelfCovered(fixture.root), []);
  });

  it('does not read a rule id out of a comment that merely quotes one', () => {
    const fixture = flatFixture({
      [`${RULES}/ci/quoting.ts`]: `
        /* Declares ids like id: 'from-block-comment' in prose. */
        // and id: 'from-line-comment' here
        export const q: IMetaRule = { id: 'quoting-rule', category: 'ci', description: 'Q.' };
      `,
      [`${RULES}/ci/quoting.test.ts`]:
        "describe('quoting-rule', () => { it('x', () => { assert.equal(v[0]?.rule, 'quoting-rule'); }); });\n",
    });

    assert.deepEqual(checkLintMetaRulesSelfCovered(fixture.root), []);
  });

  it('ignores helper modules that declare no rule, and test files themselves', () => {
    const fixture = flatFixture({
      [`${RULES}/source-text/helper.ts`]: 'export const parse = () => [];\n',
      [`${RULES}/source-text/other.test.ts`]: "describe('other', () => {});\n",
    });

    assert.deepEqual(checkLintMetaRulesSelfCovered(fixture.root), []);
  });

  it('is dormant when the fixture has no rules directory', () => {
    assert.deepEqual(checkLintMetaRulesSelfCovered(flatFixture().root), []);
  });
});
