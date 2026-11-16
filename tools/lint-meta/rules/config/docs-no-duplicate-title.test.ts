import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { docsNoDuplicateTitleRule, findLiteralH1 } from './docs-no-duplicate-title';

const DOCS = 'apps/docs/src/content/docs';

describe('docs-no-duplicate-title', () => {
  it('reports a page whose body opens with a literal H1, with its line number', () => {
    const fixture = createFixture({
      [`${DOCS}/backend/auth.md`]: '---\ntitle: Auth\n---\n\n# Auth\n\nBody.\n',
    });

    const violations = runSync(docsNoDuplicateTitleRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'docs-no-duplicate-title');
    assert.equal(violations[0]?.file, `${DOCS}/backend/auth.md`);
    assert.match(violations[0]?.message ?? '', /Literal H1 on line 5/u);
  });

  it('passes a page whose body starts at H2', () => {
    const fixture = createFixture({
      [`${DOCS}/backend/auth.md`]: '---\ntitle: Auth\n---\n\n## Overview\n\nBody.\n',
    });

    assert.deepEqual(runSync(docsNoDuplicateTitleRule, fixture.context()), []);
  });

  it('scans .mdx pages and nested directories', () => {
    const fixture = createFixture({
      [`${DOCS}/a/b/c/page.mdx`]: '---\ntitle: X\n---\n# X\n',
    });

    assert.equal(runSync(docsNoDuplicateTitleRule, fixture.context()).length, 1);
  });

  it('is dormant when the docs content directory does not exist', () => {
    assert.deepEqual(runSync(docsNoDuplicateTitleRule, createFixture().context()), []);
  });
});

describe('findLiteralH1', () => {
  it('ignores a # comment inside a fenced code block', () => {
    const source = '---\ntitle: T\n---\n\n```bash\n# install deps\npnpm i\n```\n';

    assert.equal(findLiteralH1(source), undefined);
  });

  it('finds a heading after a fence closes', () => {
    const source = '```bash\n# not a heading\n```\n\n# Real heading\n';

    assert.equal(findLiteralH1(source), 5);
  });

  it('does not close a four-backtick fence on a three-backtick line', () => {
    const source = '````md\n```\n# still inside\n```\n````\n';

    assert.equal(findLiteralH1(source), undefined);
  });

  it('handles tilde fences', () => {
    assert.equal(findLiteralH1('~~~\n# inside\n~~~\n'), undefined);
  });

  it('skips the frontmatter, including a # comment in it', () => {
    const source = '---\ntitle: T\n# yaml comment\n---\n\n## Body\n';

    assert.equal(findLiteralH1(source), undefined);
  });

  it('treats a horizontal rule that is not on the first line as body, not frontmatter', () => {
    const source = 'Intro\n\n---\n\n# Heading\n';

    assert.equal(findLiteralH1(source), 5);
  });

  it('does not count ## or a # with no space as an H1', () => {
    assert.equal(findLiteralH1('## Two\n#NoSpace\n'), undefined);
  });
});
