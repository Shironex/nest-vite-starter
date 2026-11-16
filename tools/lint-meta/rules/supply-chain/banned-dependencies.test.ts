import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { bannedDependenciesRule, checkBannedDependencies } from './banned-dependencies';

const BANNED = '@react-email/ui';

function manifest(fields: Record<string, Record<string, string>>): string {
  return JSON.stringify({ name: 'fixture', ...fields }, null, 2);
}

describe('banned-dependencies', () => {
  it('reports a banned package in any dependency field of a workspace manifest', () => {
    const fixture = createFixture({
      'apps/api/package.json': manifest({ dependencies: { [BANNED]: '^1.0.0' } }),
      'apps/web/package.json': manifest({ devDependencies: { [BANNED]: '^1.0.0' } }),
      'packages/email/package.json': manifest({ optionalDependencies: { [BANNED]: '^1.0.0' } }),
      'packages/ui/package.json': manifest({ peerDependencies: { [BANNED]: '^1.0.0' } }),
    });

    const violations = runSync(bannedDependenciesRule, fixture.context());

    assert.equal(violations.length, 4);
    for (const violation of violations) {
      assert.equal(violation.rule, 'banned-dependencies');
      assert.match(violation.message, /`@react-email\/ui` is banned from this repo/u);
    }
    assert.deepEqual(
      violations.map((violation) => /appears in (\w+)\./u.exec(violation.message)?.[1]).sort(),
      ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'],
    );
  });

  it('reports the root manifest and a tools manifest too', () => {
    const fixture = createFixture({
      'package.json': manifest({ devDependencies: { [BANNED]: '^1.0.0' } }),
      'tools/lint-meta/package.json': manifest({ dependencies: { [BANNED]: '^1.0.0' } }),
    });

    assert.equal(checkBannedDependencies(fixture.root).length, 2);
  });

  it('passes manifests that only declare allowed packages', () => {
    const fixture = createFixture({
      'package.json': manifest({ devDependencies: { turbo: '^2.0.0' } }),
      'apps/api/package.json': manifest({ dependencies: { '@react-email/components': '^1.0.0' } }),
    });

    assert.deepEqual(runSync(bannedDependenciesRule, fixture.context()), []);
  });

  it('does not read a package name out of a non-dependency field', () => {
    const fixture = createFixture({
      'apps/api/package.json': manifest({ scripts: { preview: `email dev # ${BANNED}` } }),
    });

    assert.deepEqual(checkBannedDependencies(fixture.root), []);
  });

  it('skips an unparseable manifest instead of crashing the run', () => {
    const fixture = createFixture({
      'apps/api/package.json': '{ not json',
      'apps/web/package.json': manifest({ dependencies: { [BANNED]: '^1.0.0' } }),
    });

    const violations = checkBannedDependencies(fixture.root);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.file ?? '', /apps\/web\/package\.json$/u);
  });
});
