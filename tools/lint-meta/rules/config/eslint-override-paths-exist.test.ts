import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { eslintOverridePathsExistRule } from './eslint-override-paths-exist';

const CONFIG = 'apps/web/eslint.config.js';

function config(body: string): string {
  return `export default [\n${body}\n];\n`;
}

describe('eslint-override-paths-exist', () => {
  it('reports a literal override path that no longer exists, with its line number', () => {
    const fixture = createFixture({
      [CONFIG]: config("  { files: ['src/routeTree.gen.ts'], rules: {} },"),
    });

    const violations = runSync(eslintOverridePathsExistRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'eslint-override-paths-exist');
    assert.match(
      violations[0]?.message ?? '',
      /Line 2: override references `src\/routeTree\.gen\.ts`, which does not exist/u,
    );
  });

  it('passes when the literal path exists relative to the config', () => {
    const fixture = createFixture({
      [CONFIG]: config("  { files: ['src/routeTree.gen.ts'], rules: {} },"),
      'apps/web/src/routeTree.gen.ts': 'export {};\n',
    });

    assert.deepEqual(runSync(eslintOverridePathsExistRule, fixture.context()), []);
  });

  it('ignores globs, which match zero-or-more files by design', () => {
    const fixture = createFixture({
      [CONFIG]: config(
        "  { files: ['src/**/*.ts', 'src/{a,b}.ts', '!src/x.ts', 'src/[ab].ts'], rules: {} },",
      ),
    });

    assert.deepEqual(runSync(eslintOverridePathsExistRule, fixture.context()), []);
  });

  it('ignores a path that only appears in a line comment', () => {
    const fixture = createFixture({
      [CONFIG]: config("  // was 'src/old/thing.ts', removed\n  { rules: {} },"),
    });

    assert.deepEqual(runSync(eslintOverridePathsExistRule, fixture.context()), []);
  });

  it('checks .mjs and .cjs configs in nested packages, and skips node_modules', () => {
    const fixture = createFixture({
      'packages/ui/eslint.config.mjs': config("  { ignores: ['src/gone.ts'] },"),
      'packages/node_modules/dep/eslint.config.js': config("  { ignores: ['src/gone.ts'] },"),
    });

    const violations = runSync(eslintOverridePathsExistRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.file ?? '', /packages\/ui\/eslint\.config\.mjs$/u);
  });

  it('resolves paths against the config that names them, not the repo root', () => {
    const fixture = createFixture({
      [CONFIG]: config("  { files: ['src/only-in-root.ts'] },"),
      'src/only-in-root.ts': 'export {};\n',
    });

    assert.equal(runSync(eslintOverridePathsExistRule, fixture.context()).length, 1);
  });
});
