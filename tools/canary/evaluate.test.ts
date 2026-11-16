import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ICaseResult,
  formatVerdict,
  judgeBaseline,
  judgeMutant,
  parseJestCases,
} from './evaluate';

const CASE = (fullName: string, title: string, status: string): ICaseResult => ({
  fullName,
  title,
  status,
});

const EXPECTATION = {
  why: 'workspace is the first scoped model',
  mustFail: ['suite F1 cross-tenant'],
};

describe('parseJestCases', () => {
  it('flattens every suite assertion into one list', () => {
    const cases = parseJestCases({
      testResults: [
        { assertionResults: [{ fullName: 'a b', title: 'b', status: 'passed' }] },
        { assertionResults: [{ fullName: 'c d', title: 'd', status: 'failed' }] },
      ],
    });

    assert.deepEqual(
      cases.map((one) => one.status),
      ['passed', 'failed'],
    );
  });

  it('throws on a report with no testResults instead of reading as "nothing failed"', () => {
    assert.throws(() => parseJestCases({}), /no `testResults` array/u);
  });

  it('throws on an assertion missing its status', () => {
    assert.throws(
      () =>
        parseJestCases({ testResults: [{ assertionResults: [{ fullName: 'a', title: 'a' }] }] }),
      /no fullName\/title\/status/u,
    );
  });
});

describe('judgeBaseline', () => {
  it('passes when every case passed', () => {
    const verdict = judgeBaseline([CASE('a', 'a', 'passed')]);
    assert.equal(verdict.ok, true);
  });

  it('fails, naming the case, when the lane is red before any mutant', () => {
    const verdict = judgeBaseline([CASE('a', 'a', 'passed'), CASE('b b', 'b', 'failed')]);
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.failures, ['b b']);
  });

  it('fails an empty run: no cases is not a green lane', () => {
    assert.equal(judgeBaseline([]).ok, false);
  });
});

describe('judgeMutant', () => {
  it('passes when the named case failed and the controls held', () => {
    const verdict = judgeMutant(
      'workspace',
      EXPECTATION,
      [
        CASE('suite F1 cross-tenant', 'F1 cross-tenant', 'failed'),
        CASE('s control: x', 'control: x', 'passed'),
      ],
      'control:',
    );

    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.killedBy, ['suite F1 cross-tenant']);
  });

  it('reports a survivor when the named case stayed green', () => {
    const verdict = judgeMutant(
      'workspace',
      EXPECTATION,
      [CASE('suite F1 cross-tenant', 'F1 cross-tenant', 'passed')],
      'control:',
    );

    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.survivors, ['suite F1 cross-tenant']);
    assert.match(formatVerdict(verdict).join('\n'), /survived: suite F1 cross-tenant/u);
  });

  it('reports a named case the run never reported, so a rename cannot weaken the canary', () => {
    const verdict = judgeMutant(
      'workspace',
      EXPECTATION,
      [CASE('other', 'other', 'failed')],
      'control:',
    );

    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.missing, ['suite F1 cross-tenant']);
    assert.match(formatVerdict(verdict).join('\n'), /did not run/u);
  });

  it('fails when a control broke, because then the mutant proved nothing', () => {
    const verdict = judgeMutant(
      'workspace',
      EXPECTATION,
      [
        CASE('suite F1 cross-tenant', 'F1 cross-tenant', 'failed'),
        CASE('s control: x', 'control: x', 'failed'),
      ],
      'control:',
    );

    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.brokenControls, ['s control: x']);
  });

  it('fails a mutant the manifest names no case for', () => {
    const verdict = judgeMutant(
      'invoiceLine',
      { why: 'nothing watches it', mustFail: [] },
      [CASE('a', 'a', 'passed')],
      'control:',
    );

    assert.equal(verdict.ok, false);
    assert.match(formatVerdict(verdict).join('\n'), /names no case for this mutant/u);
  });

  it('treats a skipped named case as absent rather than as a kill', () => {
    const verdict = judgeMutant(
      'workspace',
      EXPECTATION,
      [CASE('suite F1 cross-tenant', 'F1 cross-tenant', 'pending')],
      'control:',
    );

    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.missing, ['suite F1 cross-tenant']);
    assert.deepEqual(verdict.killedBy, []);
  });
});
