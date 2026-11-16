import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ICheckResult } from './result';
import { buildEvidence, exitCodeFor, overallStatus, reproduceLines } from './result';

function check(status: ICheckResult['status'], id: string = status): ICheckResult {
  return { id, status, reason: 'because', durationMs: 1 };
}

describe('verify status and exit-code mapping', () => {
  it('passes only when every check passed or did not apply', () => {
    assert.equal(overallStatus([check('passed'), check('not_applicable')], true), 'passed');
    assert.equal(exitCodeFor('passed'), 0);
  });

  it('fails when a check failed', () => {
    assert.equal(overallStatus([check('passed'), check('failed')], true), 'failed');
    assert.equal(exitCodeFor('failed'), 1);
  });

  it('blocks, not fails, when a check could not run alongside a real failure', () => {
    assert.equal(overallStatus([check('failed'), check('blocked')], true), 'blocked');
    assert.equal(exitCodeFor('blocked'), 2);
  });

  it('blocks a run whose tree moved, however green the checks are', () => {
    assert.equal(overallStatus([check('passed'), check('passed', 'second')], false), 'blocked');
  });

  it('never reports a skipped or unavailable check as a pass', () => {
    for (const blocked of ['sandbox_unavailable', 'skipped_cases', 'report_malformed']) {
      const status = overallStatus(
        [{ id: blocked, status: 'blocked', reason: blocked, durationMs: 0 }],
        true,
      );
      assert.equal(status, 'blocked');
      assert.equal(exitCodeFor(status), 2);
    }
  });

  it('builds evidence carrying the commit, the fingerprint and the exit code', () => {
    const evidence = buildEvidence({
      profile: 'release',
      runId: 'run-1',
      commit: 'abc123',
      fingerprint: 'def456',
      treeStable: true,
      startedAt: new Date('2026-09-20T10:00:00.000Z'),
      finishedAt: new Date('2026-09-20T10:01:00.000Z'),
      checks: [check('passed'), check('failed')],
    });

    assert.equal(evidence.schemaVersion, 1);
    assert.equal(evidence.profile, 'release');
    assert.equal(evidence.commit, 'abc123');
    assert.equal(evidence.fingerprint, 'def456');
    assert.equal(evidence.checks.length, 2);
    assert.equal(evidence.execution.durationMs, 60_000);
    assert.equal(evidence.execution.status, 'failed');
    assert.equal(evidence.execution.exitCode, 1);
    assert.equal(evidence.execution.treeStable, true);
  });

  it('marks an unstable tree in the evidence and exits blocked', () => {
    const evidence = buildEvidence({
      profile: 'static',
      runId: 'run-2',
      commit: 'abc123',
      fingerprint: 'def456',
      treeStable: false,
      startedAt: new Date('2026-09-20T10:00:00.000Z'),
      finishedAt: new Date('2026-09-20T10:00:05.000Z'),
      checks: [check('passed')],
    });

    assert.equal(evidence.execution.treeStable, false);
    assert.equal(evidence.execution.status, 'blocked');
    assert.equal(evidence.execution.exitCode, 2);
  });
});

describe('reproduce lines', () => {
  it('says nothing when everything passed', () => {
    assert.deepEqual(reproduceLines([check('passed'), check('not_applicable')]), []);
  });

  it('names the argv for every check that failed or was blocked', () => {
    const failed: ICheckResult = {
      id: 'check-types',
      status: 'failed',
      reason: 'exit 2',
      durationMs: 5260,
      command: ['pnpm', 'exec', 'turbo', 'check-types'],
    };
    const blocked: ICheckResult = {
      id: 'e2e',
      status: 'blocked',
      reason: 'service_unavailable',
      durationMs: 3,
      command: ['pnpm', 'e2e:lane'],
    };

    const lines = reproduceLines([check('passed'), failed, blocked]);

    assert.equal(lines.length, 3);
    assert.match(lines[0] ?? '', /re-run just what did not pass/u);
    assert.match(lines[1] ?? '', /check-types\s+pnpm exec turbo check-types/u);
    assert.match(lines[2] ?? '', /e2e\s+pnpm e2e:lane/u);
  });

  it('is honest when a result predates the recorded command', () => {
    // Evidence written before `command` existed still parses, and a line that
    // cannot name a command must not print an empty one that looks runnable.
    const lines = reproduceLines([check('failed', 'old-run')]);

    assert.match(lines[1] ?? '', /\(no command recorded\)/u);
  });
});
