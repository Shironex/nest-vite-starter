import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, messages, runSync } from '../../test-support';
import { noctcorePackagesCurrentRule } from './noctcore-packages-current';

/** A manifest declaring one `@noctcore/*` range. */
function manifest(name: string, range: string): string {
  return JSON.stringify({ name: 'fixture', devDependencies: { [name]: range } }, null, 2);
}

/** An installed package, as pnpm would lay it out for that manifest. */
function installed(version: string): string {
  return JSON.stringify({ name: '@noctcore/eslint-plugin-demo', version }, null, 2);
}

const NAME = '@noctcore/eslint-plugin-demo';
const MODULE_PATH = `node_modules/${NAME}/package.json`;

describe('noctcore-packages-current', () => {
  it('reports a caret 0.x range that cannot reach the installed minor', () => {
    const fixture = createFixture({
      'package.json': manifest(NAME, '^0.2.0'),
      [MODULE_PATH]: installed('0.3.0'),
    });

    const found = messages(runSync(noctcorePackagesCurrentRule, fixture.context()));

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /declared "\^0\.2\.0" but 0\.3\.0 is installed/u);
    assert.match(found[0] ?? '', /widen the range to "\^0\.3\.0"/u);
  });

  it('passes when the range and the installed minor agree', () => {
    const fixture = createFixture({
      'package.json': manifest(NAME, '^0.3.0'),
      [MODULE_PATH]: installed('0.3.1'),
    });

    assert.deepEqual(runSync(noctcorePackagesCurrentRule, fixture.context()), []);
  });

  it('resolves a workspace package from ITS node_modules, not the root', () => {
    // pnpm isolates by default. Reading only the root would call every
    // workspace dependency missing, which is how the first draft of this rule
    // reported eight false violations against the real tree.
    const fixture = createFixture({
      'packages/eslint-config/package.json': manifest(NAME, '^0.2.0'),
      [`packages/eslint-config/${MODULE_PATH}`]: installed('0.2.0'),
    });

    assert.deepEqual(runSync(noctcorePackagesCurrentRule, fixture.context()), []);
  });

  it('reports a declared package that is not installed anywhere', () => {
    const fixture = createFixture({ 'package.json': manifest(NAME, '^0.2.0') });

    const found = messages(runSync(noctcorePackagesCurrentRule, fixture.context()));

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /is not installed for "package\.json"/u);
  });

  it('ignores a range whose shape carries no 0.x caret pin', () => {
    // `^1.2.0` crosses minors normally, and an exact pin says what it means.
    // Neither can express the trap this rule exists for.
    const fixture = createFixture({
      'package.json': JSON.stringify({
        name: 'fixture',
        devDependencies: { [NAME]: '1.4.0' },
      }),
      [MODULE_PATH]: JSON.stringify({ name: NAME, version: '1.4.0' }),
    });

    assert.deepEqual(runSync(noctcorePackagesCurrentRule, fixture.context()), []);
  });

  it('ignores packages outside the @noctcore scope', () => {
    const fixture = createFixture({
      'package.json': JSON.stringify({
        name: 'fixture',
        devDependencies: { eslint: '^0.2.0' },
      }),
    });

    assert.deepEqual(runSync(noctcorePackagesCurrentRule, fixture.context()), []);
  });
});
