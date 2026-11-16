import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { hashEntries, treeFingerprint } from './fingerprint';
import { tempDir } from './test-support';

describe('tree fingerprint', () => {
  it('ignores the order files are listed in', () => {
    const a = hashEntries([
      { path: 'b.ts', sha: '2' },
      { path: 'a.ts', sha: '1' },
    ]);
    const b = hashEntries([
      { path: 'a.ts', sha: '1' },
      { path: 'b.ts', sha: '2' },
    ]);

    assert.equal(a, b);
  });

  it('changes when a file content changes', () => {
    const before = hashEntries([{ path: 'a.ts', sha: '1' }]);
    const after = hashEntries([{ path: 'a.ts', sha: '2' }]);

    assert.notEqual(before, after);
  });

  it('changes when a file is renamed, moved or added', () => {
    const base = hashEntries([{ path: 'a.ts', sha: '1' }]);

    assert.notEqual(base, hashEntries([{ path: 'src/a.ts', sha: '1' }]));
    assert.notEqual(
      base,
      hashEntries([
        { path: 'a.ts', sha: '1' },
        { path: 'b.ts', sha: '1' },
      ]),
    );
  });

  it('cannot be fooled by a path and a sha that concatenate the same way', () => {
    assert.notEqual(
      hashEntries([{ path: 'ab', sha: 'c' }]),
      hashEntries([{ path: 'a', sha: 'bc' }]),
    );
  });

  it('covers an untracked file and ignores a gitignored one', () => {
    const root = tempDir('verify-fingerprint');
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    };
    git('init', '-q');
    git('config', 'user.email', 'harness@example.com');
    git('config', 'user.name', 'harness');
    writeFileSync(join(root, '.gitignore'), 'ignored/\n');
    writeFileSync(join(root, 'tracked.txt'), 'one');
    git('add', '-A');
    git('commit', '-qm', 'initial');

    const base = treeFingerprint(root);

    writeFileSync(join(root, 'untracked.txt'), 'two');
    const withUntracked = treeFingerprint(root);
    assert.notEqual(withUntracked.fingerprint, base.fingerprint);
    assert.equal(withUntracked.commit, base.commit);

    execFileSync('mkdir', ['-p', join(root, 'ignored')]);
    writeFileSync(join(root, 'ignored', 'artifact.txt'), 'three');
    assert.equal(treeFingerprint(root).fingerprint, withUntracked.fingerprint);

    writeFileSync(join(root, 'tracked.txt'), 'edited mid-run');
    assert.notEqual(treeFingerprint(root).fingerprint, withUntracked.fingerprint);
  });
});
