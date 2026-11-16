import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import {
  checkTsconfigIncludePathsExist,
  literalIncludes,
  tsconfigIncludePathsExistRule,
} from './tsconfig-include-paths-exist';

const CONFIG = 'apps/web/tsconfig.app.json';

function tsconfig(include: readonly string[]): string {
  return `${JSON.stringify({ include }, null, 2)}\n`;
}

describe('tsconfig-include-paths-exist', () => {
  it('reports an include entry whose folder is gone', () => {
    const fixture = createFixture({
      [CONFIG]: tsconfig(['src', 'legacy']),
      'apps/web/src/a.ts': '',
    });

    const violations = runSync(tsconfigIncludePathsExistRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'tsconfig-include-paths-exist');
    assert.equal(violations[0]?.file, CONFIG);
    assert.match(violations[0]?.message ?? '', /`include` names `legacy`, which does not exist/u);
  });

  it('resolves entries relative to the config, not to the repo root', () => {
    const fixture = createFixture({
      [CONFIG]: tsconfig(['src']),
      'src/a.ts': '',
    });

    assert.equal(checkTsconfigIncludePathsExist(fixture.root).length, 1);
  });

  it('accepts a relative entry that climbs out of the workspace', () => {
    const fixture = createFixture({
      'tools/tsconfig.json': tsconfig(['../packages/eslint-plugin-repo/src']),
      'packages/eslint-plugin-repo/src/index.ts': '',
    });

    assert.deepEqual(checkTsconfigIncludePathsExist(fixture.root), []);
  });

  it('reads a tsconfig that carries // comments, which JSON.parse would reject', () => {
    const fixture = createFixture({
      [CONFIG]: '{\n  // The app sources.\n  "include": ["missing"]\n}\n',
    });

    assert.equal(checkTsconfigIncludePathsExist(fixture.root).length, 1);
  });

  it('is quiet for a config with no include, and for one that does not parse', () => {
    const fixture = createFixture({
      'apps/api/tsconfig.build.json': '{ "extends": "./tsconfig.json" }\n',
      'apps/api/tsconfig.broken.json': '{ "include": [\n',
    });

    assert.deepEqual(checkTsconfigIncludePathsExist(fixture.root), []);
  });

  it('skips dependency and build trees rather than reporting their tsconfigs', () => {
    const fixture = createFixture({
      'node_modules/pkg/tsconfig.json': tsconfig(['missing']),
      'apps/web/dist/tsconfig.json': tsconfig(['missing']),
    });

    assert.deepEqual(checkTsconfigIncludePathsExist(fixture.root), []);
  });

  it('is dormant on a tree with no tsconfig', () => {
    assert.deepEqual(checkTsconfigIncludePathsExist(createFixture().root), []);
  });
});

describe('literalIncludes', () => {
  it('keeps literal paths and drops globs and hidden directories', () => {
    const entries = literalIncludes(
      tsconfig([
        'src',
        'segments.ts',
        '**/*',
        'src/**/*.ts',
        '.generated/types.d.ts',
        '../packages/eslint-plugin-repo/src/types/*.d.ts',
      ]),
    );

    assert.deepEqual(entries, ['src', 'segments.ts']);
  });
});
