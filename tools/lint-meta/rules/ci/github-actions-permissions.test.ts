import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { githubActionsPermissionsRule } from './github-actions-permissions';

function violationsFor(workflows: Record<string, string>) {
  const fixture = createFixture(
    Object.fromEntries(
      Object.entries(workflows).map(([name, text]) => [`.github/workflows/${name}`, text]),
    ),
  );
  return runSync(githubActionsPermissionsRule, fixture.context());
}

describe('github-actions-permissions', () => {
  it('reports a workflow with no top-level permissions block', () => {
    const violations = violationsFor({
      'ci.yml': 'name: ci\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n',
    });

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'github-actions-permissions');
    assert.match(violations[0]?.file ?? '', /ci\.yml$/u);
    assert.match(violations[0]?.message ?? '', /missing a top-level `permissions:` block/u);
  });

  it('passes a workflow that declares least-privilege permissions', () => {
    const violations = violationsFor({
      'ci.yml': 'name: ci\non: push\npermissions:\n  contents: read\njobs: {}\n',
    });

    assert.deepEqual(violations, []);
  });

  it('accepts the empty-permissions form', () => {
    assert.deepEqual(violationsFor({ 'ci.yml': 'name: ci\npermissions: {}\njobs: {}\n' }), []);
  });

  it('does not accept a permissions block that only exists on a job', () => {
    const violations = violationsFor({
      'ci.yml':
        'name: ci\njobs:\n  test:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n',
    });

    assert.equal(violations.length, 1);
  });

  it('reports only the workflows that lack the block', () => {
    const violations = violationsFor({
      'good.yml': 'permissions:\n  contents: read\n',
      'bad.yaml': 'name: bad\n',
    });

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.file ?? '', /bad\.yaml$/u);
  });
});
