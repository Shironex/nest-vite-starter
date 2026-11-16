import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IBaseline, ICollection, ICountedFinding, IFinding, ISourceRecord } from './baseline';
import {
  ABSOLUTE_GATE_NOTICE,
  acknowledgeInto,
  buildBaseline,
  diffFindings,
  findingKey,
  formatDiff,
  formatReview,
  gradeAgainstBaseline,
  gradeExitCode,
  parseBaseline,
  reviewBaseline,
  serializeBaseline,
  tallyFindings,
  totalFindings,
} from './baseline';
import type { ICheckResult } from './result';

const AT = new Date('2026-09-20T09:00:00.000Z');

function eslintFinding(file: string, rule: string, message: string): IFinding {
  return { kind: 'eslint', file, rule, message };
}

const EXISTING = eslintFinding('apps/api/src/old.ts', 'no-console', 'Unexpected console statement');
const OTHER = eslintFinding('apps/web/src/new.tsx', 'no-alert', 'Unexpected alert');

function check(id: string, status: ICheckResult['status'], reason = 'exit 0'): ICheckResult {
  return { id, status, reason, durationMs: 1 };
}

function source(id: string, status: ISourceRecord['status'] = 'collected'): ISourceRecord {
  return { id, status, reason: status === 'collected' ? '1 finding(s)' : 'no report', count: 1 };
}

function baselineOf(options: {
  findings?: readonly ICountedFinding[];
  checks?: readonly ICheckResult[];
  sources?: readonly ISourceRecord[];
}): IBaseline {
  return buildBaseline({
    capturedAt: AT,
    baseSha: '24a2b3e2',
    fingerprint: 'fingerprint',
    profile: 'feature',
    checks: options.checks ?? [check('lint', 'passed')],
    acknowledged: [],
    findings: options.findings ?? tallyFindings([EXISTING, EXISTING]),
    sources: options.sources ?? [source('eslint')],
  });
}

function collectionOf(
  findings: readonly IFinding[],
  sources?: readonly ISourceRecord[],
): ICollection {
  return {
    commit: 'branchsha',
    fingerprint: 'branch',
    findings: tallyFindings(findings),
    sources: sources ?? [source('eslint')],
  };
}

describe('baseline keys', () => {
  it('counts the same violation twice rather than folding it into one', () => {
    const counted = tallyFindings([EXISTING, EXISTING, OTHER]);

    assert.equal(counted.length, 2);
    assert.equal(totalFindings(counted), 3);
    assert.equal(counted.find((f) => f.rule === 'no-console')?.count, 2);
  });

  it('keys on kind, file, rule and message, and on nothing else', () => {
    const line12 = findingKey(EXISTING);
    const line80 = findingKey({ ...EXISTING });

    assert.equal(line12, line80);
    assert.notEqual(line12, findingKey({ ...EXISTING, message: 'something else' }));
    assert.notEqual(line12, findingKey({ ...EXISTING, kind: 'tsc' }));
  });
});

describe('the differential diff', () => {
  it('reports a key the base did not have', () => {
    const diff = diffFindings(tallyFindings([EXISTING]), tallyFindings([EXISTING, OTHER]));

    assert.equal(diff.introduced.length, 1);
    assert.equal(diff.introduced[0]?.finding.rule, 'no-alert');
    assert.equal(diff.inherited.length, 1);
    assert.equal(diff.raised.length, 0);
  });

  // The multiset rule: adding a second copy of a violation a file already has
  // is new work, and a set-based diff would call it "already like that".
  it('fails a second copy of a violation the base already had', () => {
    const diff = diffFindings(tallyFindings([EXISTING]), tallyFindings([EXISTING, EXISTING]));

    assert.equal(diff.introduced.length, 0);
    assert.equal(diff.raised.length, 1);
    assert.deepEqual(
      { baseline: diff.raised[0]?.baseline, current: diff.raised[0]?.current },
      { baseline: 1, current: 2 },
    );
  });

  it('reports a violation the branch removed as fixed, not as a failure', () => {
    const diff = diffFindings(tallyFindings([EXISTING, EXISTING]), tallyFindings([EXISTING]));

    assert.equal(diff.fixed.length, 1);
    assert.equal(diff.introduced.length + diff.raised.length, 0);
  });

  it('names the new key in its output, so nobody has to rerun anything', () => {
    const diff = diffFindings(tallyFindings([EXISTING]), tallyFindings([EXISTING, OTHER]));
    const text = formatDiff(diff);

    assert.match(text, /NEW, and not in the base/u);
    assert.match(text, /apps\/web\/src\/new\.tsx/u);
    assert.match(text, /no-alert/u);
    assert.doesNotMatch(text, /old\.ts/u);
  });
});

describe('grading a lane', () => {
  it("passes a branch whose only violations are the base's", () => {
    const grade = gradeAgainstBaseline(baselineOf({}), collectionOf([EXISTING, EXISTING]));

    assert.equal(grade.grade, 'passed');
    assert.equal(gradeExitCode(grade.grade), 0);
    assert.equal(grade.diff.inherited.length, 1);
  });

  it('fails a branch that adds a key', () => {
    const grade = gradeAgainstBaseline(baselineOf({}), collectionOf([EXISTING, EXISTING, OTHER]));

    assert.equal(grade.grade, 'failed');
    assert.equal(gradeExitCode(grade.grade), 1);
    assert.match(grade.reason, /1 new key/u);
  });

  it('fails a branch that raises a count', () => {
    const grade = gradeAgainstBaseline(
      baselineOf({}),
      collectionOf([EXISTING, EXISTING, EXISTING]),
    );

    assert.equal(grade.grade, 'failed');
    assert.match(grade.reason, /1 raised count/u);
  });

  it('blocks when a source produced no evidence, however clean the diff looks', () => {
    const grade = gradeAgainstBaseline(
      baselineOf({}),
      collectionOf([EXISTING, EXISTING], [source('eslint'), source('test', 'blocked')]),
    );

    assert.equal(grade.grade, 'blocked');
    assert.equal(gradeExitCode(grade.grade), 2);
    assert.match(grade.reason, /no evidence from: test/u);
  });

  it('never claims to be the merge gate', () => {
    assert.match(ABSOLUTE_GATE_NOTICE, /NOT a merge gate/u);
    assert.match(ABSOLUTE_GATE_NOTICE, /profile=release/u);
  });
});

describe('a red baseline', () => {
  const red = baselineOf({
    checks: [check('lint', 'passed'), check('unit', 'failed', '2 of 46 test(s) failed')],
  });

  it('is not ok, and lists every check that did not pass', () => {
    const review = reviewBaseline(red);

    assert.equal(review.ok, false);
    assert.deepEqual(
      review.unacknowledged.map((entry) => entry.id),
      ['unit'],
    );
    assert.match(formatReview(review), /RED BASELINE/u);
    assert.match(formatReview(review), /2 of 46 test\(s\) failed/u);
  });

  it('blocks grading until somebody has looked at it', () => {
    const grade = gradeAgainstBaseline(red, collectionOf([EXISTING, EXISTING]));

    assert.equal(grade.grade, 'blocked');
    assert.match(grade.reason, /red and unacknowledged: unit/u);
  });

  it('counts a blocked check as red too: "we did not check" is not a pass', () => {
    const blocked = baselineOf({ checks: [check('isolation', 'blocked', 'service_unavailable')] });

    assert.equal(reviewBaseline(blocked).unacknowledged.length, 1);
  });

  it('is gradeable once each red check is acknowledged BY NAME, with a reason', () => {
    const acknowledged = acknowledgeInto(red, 'unit', 'flaky IBAN regex, tracked separately', AT);
    const review = reviewBaseline(acknowledged);

    assert.equal(review.ok, true);
    assert.equal(review.acknowledged.length, 1);
    assert.match(formatReview(review), /Inherited red, carried on purpose/u);
    assert.match(formatReview(review), /flaky IBAN regex/u);
    assert.equal(
      gradeAgainstBaseline(acknowledged, collectionOf([EXISTING, EXISTING])).grade,
      'passed',
    );
  });

  it('refuses to acknowledge a check that is not red, so nothing is subtracted quietly', () => {
    assert.throws(() => acknowledgeInto(red, 'lint', 'it is fine', AT), /nothing to acknowledge/u);
    assert.throws(() => acknowledgeInto(red, 'nope', 'it is fine', AT), /No check "nope"/u);
    assert.throws(() => acknowledgeInto(red, 'unit', '   ', AT), /needs a reason/u);
  });

  it('refuses to acknowledge the same check twice, which would overwrite the reason', () => {
    const once = acknowledgeInto(red, 'unit', 'first reason', AT);

    assert.throws(
      () => acknowledgeInto(once, 'unit', 'second reason', AT),
      /already acknowledged/u,
    );
  });

  it('blocks on an acknowledgment that describes a check which is not red here', () => {
    const stale: IBaseline = {
      ...baselineOf({}),
      acknowledged: [
        { check: 'unit', reason: 'from another tree', acknowledgedAt: AT.toISOString() },
      ],
    };

    assert.equal(reviewBaseline(stale).stale.length, 1);
    assert.match(
      gradeAgainstBaseline(stale, collectionOf([EXISTING, EXISTING])).reason,
      /not red in it/u,
    );
  });
});

describe('the baseline file', () => {
  it('round-trips, sorted, so two captures of one tree are byte-identical', () => {
    const baseline = baselineOf({ findings: tallyFindings([OTHER, EXISTING, EXISTING]) });
    const text = serializeBaseline(baseline);

    assert.deepEqual(parseBaseline(text), baseline);
    assert.equal(serializeBaseline(parseBaseline(text)), text);
  });

  it('refuses a document it only half understands', () => {
    const baseline = baselineOf({});
    const body = JSON.parse(serializeBaseline(baseline)) as Record<string, unknown>;

    assert.throws(() => parseBaseline('{ nope'), /not JSON/u);
    assert.throws(
      () => parseBaseline(JSON.stringify({ ...body, schemaVersion: 99 })),
      /schemaVersion 99/u,
    );
    assert.throws(
      () => parseBaseline(JSON.stringify({ ...body, findings: [{ ...EXISTING, count: 0 }] })),
      /non-count value/u,
    );
    assert.throws(
      () =>
        parseBaseline(
          JSON.stringify({ ...body, findings: [{ ...EXISTING, kind: 'vibes', count: 1 }] }),
        ),
      /not one of/u,
    );
    assert.throws(
      () =>
        parseBaseline(
          JSON.stringify({ ...body, sources: [{ ...source('eslint'), status: 'fine' }] }),
        ),
      /not one of/u,
    );
  });
});
