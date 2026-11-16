import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildContext,
  collectSourceFiles,
  findWorkflows,
  isSourceFilePath,
  resolveWorkflowsDir,
} from './context';
import { createFixture } from './test-support';

function names(root: string, files: readonly string[]): string[] {
  return files
    .map((file) =>
      file
        .slice(root.length + 1)
        .split('\\')
        .join('/'),
    )
    .sort();
}

describe('buildContext', () => {
  it('collects .ts and .tsx from src, test and tests of every apps/* and packages/* workspace', () => {
    const fixture = createFixture({
      'apps/api/src/a.ts': '',
      'apps/api/src/deep/b.tsx': '',
      'apps/web/test/c.ts': '',
      'packages/ui/tests/d.ts': '',
    });

    assert.deepEqual(names(fixture.root, fixture.context().sourceFiles), [
      'apps/api/src/a.ts',
      'apps/api/src/deep/b.tsx',
      'apps/web/test/c.ts',
      'packages/ui/tests/d.ts',
    ]);
  });

  it('collects tools/ whole, since repo tooling has no src subdir', () => {
    const fixture = createFixture({
      'tools/lint-meta/rules/ci/a.ts': '',
      'tools/verify/b.ts': '',
      'tools/lint-meta/RULES.md': '',
      'tools/node_modules/dep/c.ts': '',
    });

    assert.deepEqual(names(fixture.root, fixture.context().sourceFiles), [
      'tools/lint-meta/rules/ci/a.ts',
      'tools/verify/b.ts',
    ]);
  });

  it('leaves out other extensions, other directories, and build output', () => {
    const fixture = createFixture({
      'apps/api/src/readme.md': '',
      'apps/api/src/style.css': '',
      'apps/api/src/legacy.js': '',
      'apps/api/scripts/tool.ts': '',
      'apps/api/src/node_modules/dep/index.ts': '',
      'apps/api/src/dist/out.ts': '',
      'apps/api/src/coverage/report.ts': '',
      'apps/api/src/.turbo/cache.ts': '',
      'src/root.ts': '',
    });

    assert.deepEqual(fixture.context().sourceFiles, []);
  });

  it('finds workflows at the root, both .yml and .yaml, and ignores other files', () => {
    const fixture = createFixture({
      '.github/workflows/ci.yml': '',
      '.github/workflows/release.yaml': '',
      '.github/workflows/notes.md': '',
    });

    assert.deepEqual(names(fixture.root, fixture.context().workflowFiles), [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yaml',
    ]);
  });

  it('reports the root it was built for', () => {
    const fixture = createFixture();

    assert.equal(buildContext(fixture.root).root, fixture.root);
  });
});

describe('resolveWorkflowsDir', () => {
  it('walks up from a nested checkout to the nearest .github/workflows', () => {
    const fixture = createFixture({ '.github/workflows/ci.yml': '' });

    assert.equal(resolveWorkflowsDir(fixture.path('apps/api')), fixture.path('.github/workflows'));
  });
});

describe('collectSourceFiles and findWorkflows', () => {
  it('return nothing for a directory that does not exist', () => {
    const fixture = createFixture();

    assert.deepEqual(collectSourceFiles(fixture.path('nope')), []);
    assert.deepEqual(findWorkflows(fixture.path('nope')), []);
  });
});

describe('isSourceFilePath', () => {
  it('accepts workspace source, the scope the editor hooks guard', () => {
    assert.equal(isSourceFilePath('apps/api/src/a.ts'), true);
    assert.equal(isSourceFilePath('packages/ui/test/a.tsx'), true);
    assert.equal(isSourceFilePath('apps/web/tests/e2e/a.ts'), true);
  });

  it('rejects non-source paths, and tools/, which only buildContext scans', () => {
    assert.equal(isSourceFilePath('apps/api/src/a.js'), false);
    assert.equal(isSourceFilePath('apps/api/scripts/a.ts'), false);
    assert.equal(isSourceFilePath('apps/api/src/dist/a.ts'), false);
    assert.equal(isSourceFilePath('apps/api/src/node_modules/x/a.ts'), false);
    assert.equal(isSourceFilePath('tools/lint-meta/a.ts'), false);
    assert.equal(isSourceFilePath('apps/a.ts'), false);
    assert.equal(isSourceFilePath('other/api/src/a.ts'), false);
  });
});
