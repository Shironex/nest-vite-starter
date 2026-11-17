import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture } from '../test-support';
import { checkCiGateIntact } from './ci-gate-intact';

const CI = '.github/workflows/ci.yml';

const GOOD = `name: CI
on:
  pull_request:
    branches: [main]
jobs:
  check:
    steps:
      - run: pnpm verify --lane=format
      - run: pnpm verify --lane=lint,typecheck
      - run: pnpm verify --lane=test
      - run: pnpm verify --lane=build
`;

const messages = (files: Record<string, string>) =>
  checkCiGateIntact(createFixture(files).ctx()).map((violation) => violation.message);

describe('ci-gate-intact', () => {
  it('passes a workflow that runs every lane on pull requests', () => {
    assert.deepEqual(messages({ [CI]: GOOD }), []);
  });

  it('counts a bare pnpm verify as every lane', () => {
    assert.deepEqual(messages({ [CI]: 'on: [pull_request]\njobs:\n  - run: pnpm verify\n' }), []);
  });

  it('reports a lane CI no longer runs, ignoring a commented-out step', () => {
    const ci = GOOD.replace('- run: pnpm verify --lane=build', '# - run: pnpm verify --lane=build');
    assert.deepEqual(messages({ [CI]: ci }), [
      'ci.yml never runs the "build" lane. Add a "pnpm verify --lane=build" step to the check job.',
    ]);
  });

  it('reports --affected in CI', () => {
    const ci = GOOD.replace('--lane=test', '--lane=test --affected');
    assert.ok(messages({ [CI]: ci }).some((message) => /uses --affected in CI/u.test(message)));
  });

  it('reports a workflow that stopped running on pull_request', () => {
    const ci = GOOD.replace('  pull_request:\n    branches: [main]\n', '  push:\n');
    assert.ok(
      messages({ [CI]: ci }).some((message) => /no longer runs on pull_request/u.test(message)),
    );
  });

  it('reports continue-on-error in any workflow', () => {
    const found = messages({
      [CI]: GOOD,
      '.github/workflows/secrets.yml': 'jobs:\n  scan:\n    continue-on-error: true\n',
    });
    assert.deepEqual(found, [
      'Line 3: continue-on-error lets a failing step pass the job. Fix the step or remove it.',
    ]);
  });

  it('reports a missing ci.yml', () => {
    assert.match(messages({})[0] ?? '', /is missing/u);
  });
});
