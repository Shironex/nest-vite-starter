import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { githubActionsTimeoutRequiredRule } from './github-actions-timeout-required';

function violationsFor(text: string) {
  const fixture = createFixture({ '.github/workflows/ci.yml': text });
  return runSync(githubActionsTimeoutRequiredRule, fixture.context());
}

describe('github-actions-timeout-required', () => {
  it('reports a job with no timeout-minutes, naming the job', () => {
    const violations = violationsFor(
      'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm build\n',
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'github-actions-timeout-required');
    assert.match(violations[0]?.message ?? '', /Job "build" has no job-level `timeout-minutes:`/u);
  });

  it('passes a job that declares a positive timeout', () => {
    const violations = violationsFor(
      'jobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - run: pnpm build\n',
    );

    assert.deepEqual(violations, []);
  });

  it('rejects a zero timeout and a step-level timeout that does not cover the job', () => {
    const zero = violationsFor('jobs:\n  build:\n    timeout-minutes: 0\n    runs-on: x\n');
    const stepOnly = violationsFor(
      'jobs:\n  build:\n    runs-on: x\n    steps:\n      - run: a\n        timeout-minutes: 5\n',
    );

    assert.equal(zero.length, 1);
    assert.equal(stepOnly.length, 1);
  });

  it('exempts a reusable-workflow call, which cannot set a timeout', () => {
    const violations = violationsFor(
      'jobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n',
    );

    assert.deepEqual(violations, []);
  });

  it('checks every job independently', () => {
    const violations = violationsFor(
      [
        'jobs:',
        '  lint:',
        '    timeout-minutes: 10',
        '    runs-on: x',
        '  test:',
        '    runs-on: x',
        '  deploy:',
        '    runs-on: x',
        '',
      ].join('\n'),
    );

    assert.deepEqual(
      violations.map((violation) => /Job "(\w+)"/u.exec(violation.message)?.[1]),
      ['test', 'deploy'],
    );
  });

  it('stops reading jobs at the next top-level key', () => {
    const violations = violationsFor(
      'jobs:\n  build:\n    timeout-minutes: 5\n    runs-on: x\nenv:\n  FOO: bar\n',
    );

    assert.deepEqual(violations, []);
  });

  it('reports nothing for a workflow with no jobs block', () => {
    assert.deepEqual(violationsFor('name: empty\non: push\n'), []);
  });
});
