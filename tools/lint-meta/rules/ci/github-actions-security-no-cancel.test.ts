import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import {
  checkSecurityWorkflowNoCancel,
  githubActionsSecurityNoCancelRule,
} from './github-actions-security-no-cancel';

function workflow(name: string, text: string): string {
  return createFixture({ [`.github/workflows/${name}`]: text }).path(`.github/workflows/${name}`);
}

/** security-secrets.yml exactly as it shipped before its concurrency block was removed. */
const OLD_SHAPE = `name: security-secrets

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: security-secrets-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - run: gitleaks git .
`;

/** The shipped fix: no block, with a comment that quotes the forbidden shape. */
const FIXED_SHAPE = `name: security-secrets

on:
  push:
    branches: [main]

# Deliberately NO \`concurrency\` block. \`cancel-in-progress:
# true\` lets a newer push cancel an older run; \`concurrency: group: x\` would let
# a new run replace a pending one.

permissions:
  contents: read

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - run: gitleaks git .
`;

function withConcurrency(block: string, name = 'security-secrets.yml'): string {
  return workflow(name, `name: x\non: push\n${block}\njobs:\n  scan:\n    runs-on: x\n`);
}

describe('github-actions-security-no-cancel', () => {
  it('reports the old security-secrets shape: canceling, and a group shared per ref', () => {
    const violations = checkSecurityWorkflowNoCancel(workflow('security-secrets.yml', OLD_SHAPE));

    assert.equal(violations.length, 2);
    for (const violation of violations) {
      assert.equal(violation.rule, 'github-actions-security-no-cancel');
    }
    assert.match(violations[0]?.message ?? '', /Line 9: .*`cancel-in-progress: true`/u);
    assert.match(
      violations[1]?.message ?? '',
      /Line 9: .*group `security-secrets-\$\{\{ github\.ref \}\}` is not keyed on the commit/u,
    );
  });

  it('passes the fixed shape, even though its comment quotes cancel-in-progress: true', () => {
    assert.deepEqual(
      checkSecurityWorkflowNoCancel(workflow('security-secrets.yml', FIXED_SHAPE)),
      [],
    );
  });

  it('reports a group that is not commit-keyed even when it does not cancel', () => {
    const violations = checkSecurityWorkflowNoCancel(
      withConcurrency('concurrency:\n  group: security-secrets\n  cancel-in-progress: false'),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /REPLACES the pending one/u);
  });

  it('passes a non-cancelling group keyed on github.sha or github.run_id', () => {
    for (const key of ['github.sha', 'github.run_id', 'github.event.pull_request.head.sha']) {
      const file = withConcurrency(
        `concurrency:\n  group: security-secrets-\${{ ${key} }}\n  cancel-in-progress: false`,
      );
      assert.deepEqual(checkSecurityWorkflowNoCancel(file), []);
    }
  });

  it('still reports cancel-in-progress: true on a commit-keyed group', () => {
    const violations = checkSecurityWorkflowNoCancel(
      withConcurrency('concurrency:\n  group: s-${{ github.sha }}\n  cancel-in-progress: true'),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /`cancel-in-progress: true`/u);
  });

  it('treats a non-literal cancel-in-progress expression as canceling', () => {
    const violations = checkSecurityWorkflowNoCancel(
      withConcurrency(
        "concurrency:\n  group: s-${{ github.sha }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      ),
    );

    assert.equal(violations.length, 1);
  });

  it('reads the flow-mapping and scalar forms of the concurrency key', () => {
    const cancelling = withConcurrency(
      'concurrency: { group: security-secrets-${{ github.ref }}, cancel-in-progress: true }',
    );
    const keyed = withConcurrency(
      'concurrency: { cancel-in-progress: false, group: s-${{ github.sha }} }',
    );
    const scalar = withConcurrency('concurrency: security-secrets');

    assert.equal(checkSecurityWorkflowNoCancel(cancelling).length, 2);
    assert.deepEqual(checkSecurityWorkflowNoCancel(keyed), []);
    assert.equal(checkSecurityWorkflowNoCancel(scalar).length, 1);
  });

  it('reads a job-level concurrency block too', () => {
    const file = workflow(
      'security-secrets.yml',
      'jobs:\n  scan:\n    runs-on: x\n    concurrency:\n      group: scan\n      cancel-in-progress: true\n',
    );

    assert.equal(checkSecurityWorkflowNoCancel(file).length, 2);
  });

  it('flags a workflow that runs gitleaks even when it is not named security-*', () => {
    const named = workflow(
      'secrets.yml',
      'concurrency:\n  group: g-${{ github.ref }}\n  cancel-in-progress: true\njobs:\n  scan:\n    runs-on: x\n    steps:\n      - run: gitleaks git .\n',
    );
    const action = workflow(
      'scan.yml',
      'concurrency:\n  group: g\njobs:\n  scan:\n    steps:\n      - uses: gitleaks/gitleaks-action@v2\n',
    );

    assert.equal(checkSecurityWorkflowNoCancel(named).length, 2);
    assert.equal(checkSecurityWorkflowNoCancel(action).length, 1);
  });

  it('leaves an ordinary workflow alone, including one that cancels superseded runs', () => {
    const ci = workflow(
      'ci.yml',
      'concurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\njobs:\n  test:\n    steps:\n      - run: echo gitleaks is mentioned in a name only\n',
    );

    assert.deepEqual(checkSecurityWorkflowNoCancel(ci), []);
  });

  it('passes a security workflow with no concurrency block at all', () => {
    assert.deepEqual(
      checkSecurityWorkflowNoCancel(workflow('security-deps.yml', 'name: deps\njobs: {}\n')),
      [],
    );
  });

  it('runs over every workflow file in the context', () => {
    const fixture = createFixture({
      '.github/workflows/security-secrets.yml': OLD_SHAPE,
      '.github/workflows/ci.yml': 'name: ci\n',
    });

    assert.equal(runSync(githubActionsSecurityNoCancelRule, fixture.context()).length, 2);
  });
});
