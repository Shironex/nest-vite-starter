import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IJUnitCase } from '../quality/junit';
import type { IInventory } from './inventory';
import {
  acceptInto,
  auditMerge,
  diffInventory,
  expectedAtMerge,
  normalizeFile,
  isSyntheticCase,
  normalizeTitle,
  observe,
  parseInventory,
  serializeInventory,
  tally,
  totalCases,
} from './inventory';
import { INVENTORY_SUITES, suiteById } from './inventory-suites';

function junitCase(overrides: Partial<IJUnitCase> = {}): IJUnitCase {
  return {
    suite: 'thing.spec.ts',
    file: 'src/thing.spec.ts',
    name: 'thing > does the thing',
    status: 'passed',
    messages: [],
    ...overrides,
  };
}

function inventory(suite: string, cases: Record<string, Record<string, number>>): IInventory {
  return { suite, cases };
}

describe('inventory normalization', () => {
  it('replaces the worktree path, so two checkouts write the same title', () => {
    const root = '/Users/someone/worktrees/lane-a';

    assert.equal(normalizeTitle(`reads ${root}/apps/api/x`, root), 'reads <root>/apps/api/x');
  });

  it('collapses whitespace, so a title wrapped in source reads as one line', () => {
    assert.equal(normalizeTitle('keeps  the\n  boundary   real', ''), 'keeps the boundary real');
  });

  it('files a case under the suite path base, because each runner roots paths differently', () => {
    assert.equal(normalizeFile('src/thing.spec.ts', 'apps/api'), 'apps/api/src/thing.spec.ts');
    assert.equal(normalizeFile('./auth.spec.ts', 'apps/web/e2e'), 'apps/web/e2e/auth.spec.ts');
  });

  it('marks a skipped case, and only a skipped one', () => {
    const seen = observe(
      [
        junitCase({ status: 'passed' }),
        junitCase({ name: 'thing > later', status: 'skipped' }),
        junitCase({ name: 'thing > broken', status: 'errored' }),
      ],
      { pathBase: 'apps/api', root: '' },
    );

    assert.deepEqual(
      seen.map((observed) => observed.skipped),
      [false, true, false],
    );
  });

  /*
   * A suite-level hook failure makes jest emit one synthetic entry per file.
   * Recording it would make every later GREEN run look like it lost a case,
   * so the gate would be demanding that the hook keep failing. It happens
   * whenever a merge breaks a suite hook.
   */
  it('drops the synthetic case jest emits when a suite hook throws', () => {
    const seen = observe(
      [
        junitCase({ name: 'thing > real', status: 'passed' }),
        junitCase({
          name: "> Test execution failure: could be caused by test hooks like 'afterAll'.",
          status: 'errored',
        }),
      ],
      { pathBase: 'apps/api', root: '' },
    );

    assert.deepEqual(
      seen.map((observed) => observed.fullName),
      ['thing > real'],
    );
    assert.equal(isSyntheticCase('> Test execution failure: could be caused by test hooks'), true);
    assert.equal(isSyntheticCase('reports a test execution failure to the user'), false);
  });

  it('counts the same [file, fullName] twice rather than losing one', () => {
    const observed = tally('api', observe([junitCase(), junitCase()], { pathBase: '', root: '' }));

    assert.equal(observed.cases['src/thing.spec.ts']?.['thing > does the thing'], 2);
    assert.equal(totalCases(observed), 2);
  });
});

describe('inventory diff', () => {
  const baseline = inventory('api', { 'a.spec.ts': { one: 1, two: 1 } });

  it('reports a deleted test as missing', () => {
    const findings = diffInventory(baseline, inventory('api', { 'a.spec.ts': { one: 1 } }), []);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, 'missing');
    assert.equal(findings[0]?.fullName, 'two');
  });

  it('reports a case the baseline never listed as unexpected', () => {
    const findings = diffInventory(
      baseline,
      inventory('api', { 'a.spec.ts': { one: 1, two: 1, three: 1 } }),
      [],
    );

    assert.deepEqual(
      findings.map((finding) => [finding.kind, finding.fullName]),
      [['unexpected', 'three']],
    );
  });

  it('reports a duplicated title as a count change, because both run under one name', () => {
    const findings = diffInventory(
      baseline,
      inventory('api', { 'a.spec.ts': { one: 2, two: 1 } }),
      [],
    );

    assert.equal(findings[0]?.kind, 'duplicate');
    assert.match(findings[0]?.detail ?? '', /expected 1, ran 2/u);
  });

  it('reports a skipped case even when the counts agree', () => {
    const findings = diffInventory(
      baseline,
      inventory('api', { 'a.spec.ts': { one: 1, two: 1 } }),
      [{ file: 'a.spec.ts', fullName: 'two', skipped: true }],
    );

    assert.deepEqual(
      findings.map((finding) => finding.kind),
      ['skipped'],
    );
  });

  it('says nothing when the run matches', () => {
    assert.deepEqual(diffInventory(baseline, baseline, []), []);
  });
});

describe('inventory acceptance', () => {
  const baseline = inventory('api', { 'a.spec.ts': { one: 1, two: 1 } });

  it('writes additions', () => {
    const accepted = acceptInto(
      baseline,
      inventory('api', { 'a.spec.ts': { one: 1, two: 1, three: 1 } }),
      false,
    );

    assert.equal(accepted.refused.length, 0);
    assert.equal(accepted.next.cases['a.spec.ts']?.['three'], 1);
  });

  it('refuses a removal until --allow-removals says so, and keeps the old count', () => {
    const accepted = acceptInto(baseline, inventory('api', { 'a.spec.ts': { one: 1 } }), false);

    assert.deepEqual(
      accepted.refused.map((finding) => finding.fullName),
      ['two'],
    );
    assert.equal(accepted.next.cases['a.spec.ts']?.['two'], 1);
  });

  it('writes the removal once --allow-removals is passed', () => {
    const accepted = acceptInto(baseline, inventory('api', { 'a.spec.ts': { one: 1 } }), true);

    assert.equal(accepted.refused.length, 0);
    assert.equal(accepted.next.cases['a.spec.ts']?.['two'], undefined);
  });

  it('drops a file that lost every case rather than leaving an empty object', () => {
    const accepted = acceptInto(baseline, inventory('api', {}), true);

    assert.deepEqual(accepted.next.cases, {});
  });
});

describe('the merge rule', () => {
  it('takes the side that moved, and allows either when both moved', () => {
    assert.equal(expectedAtMerge(1, 1, 1), 1);
    assert.equal(expectedAtMerge(1, 0, 1), 0);
    assert.equal(expectedAtMerge(1, 1, 2), 2);
    assert.equal(expectedAtMerge(1, 0, 2), 'either');
  });

  it('flags a case that vanished in the merge although only one parent added it', () => {
    const findings = auditMerge('api', {
      base: inventory('api', {}),
      left: inventory('api', { 'a.spec.ts': { one: 1 } }),
      right: inventory('api', {}),
      merged: inventory('api', {}),
    });

    assert.deepEqual(
      findings.map((finding) => [finding.kind, finding.fullName]),
      [['merge-damage', 'one']],
    );
  });

  it('flags a case that appeared in the merge although neither parent has it', () => {
    const findings = auditMerge('api', {
      base: inventory('api', {}),
      left: inventory('api', {}),
      right: inventory('api', {}),
      merged: inventory('api', { 'a.spec.ts': { one: 1 } }),
    });

    assert.equal(findings.length, 1);
    assert.match(findings[0]?.detail ?? '', /neither parent explains 1/u);
  });

  it('says nothing about two lanes that each added their own cases', () => {
    const findings = auditMerge('api', {
      base: inventory('api', { 'a.spec.ts': { one: 1 } }),
      left: inventory('api', { 'a.spec.ts': { one: 1, fromLeft: 1 } }),
      right: inventory('api', { 'a.spec.ts': { one: 1, fromRight: 1 } }),
      merged: inventory('api', { 'a.spec.ts': { one: 1, fromLeft: 1, fromRight: 1 } }),
    });

    assert.deepEqual(findings, []);
  });
});

describe('inventory serialization', () => {
  it('sorts files and names, so a baseline diff is a diff of the test list', () => {
    const text = serializeInventory(
      inventory('api', { 'b.spec.ts': { one: 1 }, 'a.spec.ts': { z: 1, a: 2 } }),
    );

    assert.equal(
      text,
      `{
  "suite": "api",
  "cases": {
    "a.spec.ts": {
      "a": 2,
      "z": 1
    },
    "b.spec.ts": {
      "one": 1
    }
  }
}
`,
    );
  });

  it('round-trips', () => {
    const original = inventory('api', { 'a.spec.ts': { one: 1, two: 3 } });

    assert.deepEqual(parseInventory(serializeInventory(original), 'api'), original);
  });

  it('refuses a baseline that names a different suite', () => {
    assert.throws(() => parseInventory('{"suite":"web","cases":{}}', 'api'), /names suite "web"/u);
  });

  it('refuses a count that is not a count', () => {
    assert.throws(
      () => parseInventory('{"suite":"api","cases":{"a.spec.ts":{"one":0}}}', 'api'),
      /non-count value/u,
    );
  });
});

describe('the suite registry', () => {
  it('gives every suite a unique id, report path and baseline', () => {
    const ids = INVENTORY_SUITES.map((suite) => suite.id);
    const reports = INVENTORY_SUITES.map((suite) => suite.report);

    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(reports).size, reports.length);
  });

  it('names the suite a report belongs to', () => {
    assert.equal(suiteById('api').pathBase, 'apps/api');
    assert.throws(() => suiteById('nope'), /Unknown suite "nope"/u);
  });

  it('only lets the e2e lane be on demand, since it is the only one that boots a stack', () => {
    assert.deepEqual(
      INVENTORY_SUITES.filter((suite) => suite.onDemand === true).map((suite) => suite.id),
      ['e2e'],
    );
  });
});
