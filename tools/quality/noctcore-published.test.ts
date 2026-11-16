import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classify, parseVersion, rangeAdmits, type IPackageState } from './noctcore-published';

function state(overrides: Partial<IPackageState>): IPackageState {
  return {
    name: '@noctcore/eslint-plugin-demo',
    range: '^0.3.0',
    file: 'packages/eslint-config/package.json',
    block: 'dependencies',
    installed: '0.3.0',
    published: '0.3.0',
    ...overrides,
  };
}

function admits(range: string, version: string): boolean | null {
  const parsed = parseVersion(version);
  assert.ok(parsed);
  return rangeAdmits(range, parsed);
}

describe('rangeAdmits', () => {
  it('holds a caret on 0.x to its minor', () => {
    assert.equal(admits('^0.5.0', '0.5.9'), true);
    assert.equal(admits('^0.5.0', '0.6.0'), false);
    assert.equal(admits('^0.5.1', '0.5.0'), false);
  });

  it('holds a caret on 0.0.x to its patch and on 1.x to its major', () => {
    assert.equal(admits('^0.0.3', '0.0.4'), false);
    assert.equal(admits('^1.2.0', '1.9.0'), true);
    assert.equal(admits('^1.2.0', '2.0.0'), false);
  });

  it('reads tilde and exact ranges, and refuses anything else', () => {
    assert.equal(admits('~0.3.0', '0.3.4'), true);
    assert.equal(admits('~0.3.0', '0.4.0'), false);
    assert.equal(admits('0.3.0', '0.3.0'), true);
    assert.equal(admits('0.3.0', '0.3.1'), false);
    assert.equal(admits('>=0.3.0', '0.3.1'), null);
    assert.equal(admits('workspace:*', '0.3.1'), null);
  });
});

describe('classify', () => {
  it('passes a package installed at the published latest', () => {
    assert.equal(classify(state({ installed: '0.3.1', published: '0.3.1' })), null);
  });

  it('calls a caret that cannot reach the published minor unreachable, with the command to widen it', () => {
    const finding = classify(state({ range: '^0.5.0', installed: '0.5.0', published: '0.6.0' }));

    assert.equal(finding?.kind, 'unreachable');
    assert.match(finding?.message ?? '', /RANGE CANNOT REACH THE PUBLISHED VERSION/u);
    assert.match(finding?.message ?? '', /does not cross the minor/u);
    assert.match(
      finding?.message ?? '',
      /`pnpm --dir packages\/eslint-config add @noctcore\/eslint-plugin-demo@\^0\.6\.0`/u,
    );
  });

  it('writes the root form of the widen command for a root devDependency', () => {
    const finding = classify(
      state({
        file: 'package.json',
        block: 'devDependencies',
        range: '^0.3.0',
        published: '0.4.0',
      }),
    );

    assert.match(
      finding?.message ?? '',
      /`pnpm add -w -D @noctcore\/eslint-plugin-demo@\^0\.4\.0`/u,
    );
  });

  it('calls a range that admits the latest but is installed behind it a stale lockfile', () => {
    const finding = classify(state({ range: '^0.3.0', installed: '0.3.0', published: '0.3.1' }));

    assert.equal(finding?.kind, 'stale-lockfile');
    assert.match(finding?.message ?? '', /LOCKFILE IS STALE/u);
    assert.match(finding?.message ?? '', /`pnpm update -r @noctcore\/eslint-plugin-demo`/u);
    assert.doesNotMatch(finding?.message ?? '', /CANNOT REACH/u);
  });

  it('calls a declared package that is not installed a stale lockfile', () => {
    assert.equal(classify(state({ installed: null, published: '0.3.0' }))?.kind, 'stale-lockfile');
  });

  it('reports a range that asks for more than the registry has', () => {
    const finding = classify(state({ range: '^0.7.0', installed: null, published: '0.6.0' }));

    assert.equal(finding?.kind, 'ahead-of-registry');
  });

  it('reports a range shape it cannot read instead of guessing', () => {
    assert.equal(
      classify(state({ range: '>=0.3.0', published: '0.3.1' }))?.kind,
      'unrecognised-range',
    );
  });
});
