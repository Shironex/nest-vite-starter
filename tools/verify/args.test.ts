import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertKnownFlags, boolFlag, parseArgs, stringFlag } from './args';

describe('CLI argument parsing', () => {
  it('takes the first bare word as the command and both flag forms', () => {
    const parsed = parseArgs(['up', '--json', '--profile=release']);

    assert.equal(parsed.command, 'up');
    assert.equal(boolFlag(parsed, 'json'), true);
    assert.equal(stringFlag(parsed, 'profile'), 'release');
    assert.equal(stringFlag(parsed, 'json'), null);
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    const parsed = parseArgs(['--prfile=release']);

    assert.throws(() => assertKnownFlags(parsed, ['profile'], 'usage'), /--prfile/u);
  });

  it('accepts an empty flag value', () => {
    assert.equal(stringFlag(parseArgs(['--profile=']), 'profile'), '');
  });
});
