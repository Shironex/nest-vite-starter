import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { checkPrePushCiParity, prePushCiParityRule } from './pre-push-ci-parity';

const MANIFEST = 'scripts/ci/pre-push.manifest.json';

function manifest(commands: readonly string[], ciWorkflow = '.github/workflows/ci.yml'): string {
  return JSON.stringify({ ciWorkflow, requiredCommands: commands });
}

describe('pre-push-ci-parity', () => {
  it('reports a manifest command that CI does not run', () => {
    const fixture = createFixture({
      [MANIFEST]: manifest(['pnpm lint:meta', 'pnpm test:lint-meta']),
      '.github/workflows/ci.yml': '      - run: pnpm lint:meta\n',
    });

    const violations = runSync(prePushCiParityRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'pre-push-ci-parity');
    assert.equal(violations[0]?.file, '.github/workflows/ci.yml');
    assert.match(violations[0]?.message ?? '', /requires `pnpm test:lint-meta`/u);
  });

  it('passes when every manifest command appears in the workflow', () => {
    const fixture = createFixture({
      [MANIFEST]: manifest(['pnpm lint:meta', 'pnpm test:lint-meta']),
      '.github/workflows/ci.yml': '      - run: pnpm lint:meta\n      - run: pnpm test:lint-meta\n',
    });

    assert.deepEqual(checkPrePushCiParity(fixture.root), []);
  });

  it('is dormant when there is no manifest', () => {
    const fixture = createFixture();

    assert.deepEqual(checkPrePushCiParity(fixture.root), []);
  });

  it('reports a malformed manifest instead of passing', () => {
    const notJson = createFixture({ [MANIFEST]: '{ nope' });
    const wrongShape = createFixture({
      [MANIFEST]: JSON.stringify({ ciWorkflow: 1, requiredCommands: 'pnpm lint' }),
    });
    const badCommand = createFixture({
      [MANIFEST]: JSON.stringify({ ciWorkflow: 'ci.yml', requiredCommands: [1] }),
    });

    for (const fixture of [notJson, wrongShape, badCommand]) {
      const violations = checkPrePushCiParity(fixture.root);
      assert.equal(violations.length, 1);
      assert.match(violations[0]?.message ?? '', /malformed/u);
    }
  });

  it('reports a manifest that points at a workflow that does not exist', () => {
    const fixture = createFixture({ [MANIFEST]: manifest(['pnpm lint:meta']) });

    const violations = checkPrePushCiParity(fixture.root);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /points at ".github\/workflows\/ci\.yml"/u);
  });

  it('cannot see a command that CI wraps onto a second line', () => {
    const fixture = createFixture({
      [MANIFEST]: manifest(['pnpm exec turbo lint']),
      '.github/workflows/ci.yml': '      - run: pnpm exec\n          turbo lint\n',
    });

    // Documents the substring limit stated in the rule: a wrapped run line is a violation.
    assert.equal(checkPrePushCiParity(fixture.root).length, 1);
  });
});
