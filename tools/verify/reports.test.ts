import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classify, parseJestJson, parseJunit } from './reports';

const JUNIT_GREEN =
  '<?xml version="1.0"?>\n<testsuites id="" name="" tests="46" failures="0" skipped="0" errors="0" time="120">\n</testsuites>';

function jestJson(overrides: Readonly<Record<string, number>> = {}): string {
  return JSON.stringify({
    numTotalTests: 10,
    numPassedTests: 10,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    ...overrides,
  });
}

describe('test report classification', () => {
  it('reads the totals off a JUnit root element', () => {
    assert.deepEqual(parseJunit(JUNIT_GREEN), { tests: 46, failures: 0, skipped: 0 });
  });

  it('sums per-suite JUnit totals when there is no root element', () => {
    const xml =
      '<testsuite tests="2" failures="1" skipped="0"></testsuite>\n<testsuite tests="3" failures="0" skipped="1"></testsuite>';

    assert.deepEqual(parseJunit(xml), { tests: 5, failures: 1, skipped: 1 });
  });

  it('counts JUnit errors as failures', () => {
    const xml = '<testsuites tests="4" failures="1" errors="2" skipped="0"></testsuites>';

    assert.deepEqual(parseJunit(xml), { tests: 4, failures: 3, skipped: 0 });
  });

  it('counts jest pending and todo cases as skipped', () => {
    assert.deepEqual(parseJestJson(jestJson({ numPendingTests: 2, numTodoTests: 1 })), {
      tests: 10,
      failures: 0,
      skipped: 3,
    });
  });

  it('returns null for a report that did not parse', () => {
    assert.equal(parseJunit('not xml at all'), null);
    assert.equal(parseJestJson('{ nope'), null);
    assert.equal(parseJestJson(JSON.stringify({ numTotalTests: 'many' })), null);
  });

  it('passes a green run', () => {
    assert.deepEqual(classify(parseJunit(JUNIT_GREEN), 0), {
      status: 'passed',
      reason: '46 test(s) passed',
    });
  });

  it('fails a run with failures and a matching exit code', () => {
    const verdict = classify({ tests: 46, failures: 2, skipped: 0 }, 1);

    assert.equal(verdict.status, 'failed');
    assert.match(verdict.reason, /2 of 46/u);
  });

  it('blocks a skipped case rather than passing it', () => {
    const verdict = classify({ tests: 46, failures: 0, skipped: 1 }, 0);

    assert.equal(verdict.status, 'blocked');
    assert.match(verdict.reason, /skipped_cases/u);
  });

  it('blocks a malformed or empty report', () => {
    assert.equal(classify(null, 0).status, 'blocked');
    assert.equal(classify(null, 0).reason, 'report_malformed');
    assert.equal(classify({ tests: 0, failures: 0, skipped: 0 }, 0).reason, 'report_empty');
  });

  it('blocks an exit code that disagrees with the totals, in both directions', () => {
    const greenButNonZero = classify({ tests: 5, failures: 0, skipped: 0 }, 1);
    const redButZero = classify({ tests: 5, failures: 1, skipped: 0 }, 0);

    assert.equal(greenButNonZero.status, 'blocked');
    assert.match(greenButNonZero.reason, /exit_code_disagrees/u);
    assert.equal(redButZero.status, 'blocked');
    assert.match(redButZero.reason, /exit_code_disagrees/u);
  });
});
