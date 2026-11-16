import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stripYamlComment, unquote } from './repo-files';

describe('stripYamlComment', () => {
  it('drops a whole-line comment and a trailing one', () => {
    assert.equal(stripYamlComment('  # pinned by hand').trim(), '');
    assert.equal(
      stripYamlComment('    image: postgres:18 # v18').trimEnd(),
      '    image: postgres:18',
    );
  });

  it('keeps a `#` that is part of a value, such as an image digest', () => {
    const line = '    image: postgres@sha256:abc#def';

    assert.equal(stripYamlComment(line), line);
  });
});

describe('unquote', () => {
  it('removes matching surrounding quotes and surrounding whitespace', () => {
    assert.equal(unquote('  "postgres:18"  '), 'postgres:18');
    assert.equal(unquote("'postgres:18'"), 'postgres:18');
    assert.equal(unquote('postgres:18'), 'postgres:18');
  });

  it('leaves mismatched quotes alone rather than half-stripping them', () => {
    assert.equal(unquote('"postgres:18\''), '"postgres:18\'');
  });
});
