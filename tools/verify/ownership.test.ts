import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { agentStateDir, ownerId, sandboxesDir, verificationDir } from './ownership';
import { tempDir } from './test-support';

describe('worktree ownership', () => {
  it('gives two worktrees different owner ids, which is what keeps their sandboxes apart', () => {
    const root = tempDir('verify-owner');
    mkdirSync(join(root, 'one'));
    mkdirSync(join(root, 'two'));

    assert.notEqual(ownerId(join(root, 'one')), ownerId(join(root, 'two')));
  });

  it('gives a symlinked path the same owner id as the directory it resolves to', () => {
    const root = tempDir('verify-owner-link');
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'link'));

    assert.equal(ownerId(join(root, 'link')), ownerId(join(root, 'real')));
  });

  it('keeps every piece of state under the one gitignored directory', () => {
    const root = tempDir('verify-owner-paths');

    assert.equal(agentStateDir(root), join(root, '.agent-state'));
    assert.ok(sandboxesDir(root).startsWith(agentStateDir(root)));
    assert.ok(verificationDir(root).startsWith(agentStateDir(root)));
  });
});
