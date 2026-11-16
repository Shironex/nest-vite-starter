import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RULE_IDS as UPSTREAM_RULE_IDS } from '@noctcore/lint-meta-rules';

import { META_RULES } from './registry';
import { RULE_MODULE_DIRS, declaredRuleIds } from './rules/testing/lint-meta-rules-self-covered';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CATEGORIES = ['config', 'source-text', 'supply-chain', 'ci', 'testing'];

/** Every local rule module in a RULE_MODULE_DIRS directory, as `{ file, source }`, tests excluded. */
function ruleModules(): { file: string; source: string }[] {
  const modules: { file: string; source: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        modules.push({ file: full, source: readFileSync(full, 'utf8') });
      }
    }
  };
  for (const dir of RULE_MODULE_DIRS) {
    assert.ok(existsSync(join(REPO_ROOT, dir)), dir);
    walk(join(REPO_ROOT, dir));
  }

  return modules;
}

describe('META_RULES registry', () => {
  it('has unique rule ids, so a violation always names exactly one rule', () => {
    const ids = META_RULES.map((rule) => rule.id);

    assert.deepEqual(ids, [...new Set(ids)]);
  });

  it('gives every rule a known category, a description and at least one pass', () => {
    for (const rule of META_RULES) {
      assert.ok(
        CATEGORIES.includes(rule.category),
        `${rule.id}: unknown category ${rule.category}`,
      );
      assert.ok(rule.description.trim().length > 0, `${rule.id}: empty description`);
      assert.ok(
        rule.run !== undefined || rule.runAsync !== undefined,
        `${rule.id}: has neither run nor runAsync, so it can never report anything`,
      );
    }
  });

  /*
   * The harness reds the build only for a ciCritical rule and prints the rest
   * as [info]. registry.ts refuses to load otherwise (assertEveryRuleBlocks), so
   * this can only fail if that guard is removed; it is here so removing it is
   * a red test and not a quiet change of policy.
   */
  it('marks every rule ciCritical, so the harness reds the build for every one of them', () => {
    const unflagged = META_RULES.filter((rule) => rule.ciCritical !== true).map((rule) => rule.id);

    assert.deepEqual(unflagged, []);
  });

  it('admits no ratcheting rule, so no offender is grandfathered', () => {
    const ratcheting = META_RULES.filter((rule) => rule.baseline !== undefined).map(
      (rule) => rule.id,
    );

    assert.deepEqual(ratcheting, []);
  });

  it('registers every rule id that a rule module declares', () => {
    const registered = new Set(META_RULES.map((rule) => rule.id));
    const unregistered = ruleModules().flatMap(({ source }) =>
      declaredRuleIds(source).filter((id) => !registered.has(id)),
    );

    assert.deepEqual(unregistered, []);
  });

  /*
   * An async-only rule that lost its `runAsync` on the way into the harness
   * would still register, still render in RULES.md, and never run. Derived from
   * the rule modules, not from a list: every module that defines an async pass
   * must reach the registry with one.
   */
  it('keeps the async pass of every rule module that defines one', () => {
    const asyncIds = ruleModules()
      .filter(({ source }) => /\brunAsync\s*[:(]/u.test(source))
      .flatMap(({ source }) => declaredRuleIds(source));
    const byId = new Map(META_RULES.map((rule) => [rule.id, rule]));

    assert.ok(asyncIds.length > 0, 'no rule module defines an async pass; the scan is broken');
    for (const id of asyncIds) {
      assert.equal(typeof byId.get(id)?.runAsync, 'function', `${id}: async pass was dropped`);
    }
  });

  /*
   * A rule the package ships is used from the package. A local copy of one
   * would be the drift the upstream promotion exists to prevent: two
   * implementations of one id, fixed in one place and not the other.
   */
  it('keeps no local copy of a rule @noctcore/lint-meta-rules ships', () => {
    const upstream = new Set<string>(UPSTREAM_RULE_IDS);
    const copies = ruleModules().flatMap(({ file, source }) =>
      declaredRuleIds(source)
        .filter((id) => upstream.has(id))
        .map((id) => `${id} (${file})`),
    );

    assert.deepEqual(copies, []);
  });
});
