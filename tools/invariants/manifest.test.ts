import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, type IFixture } from '../lint-meta/test-support';
import { checkManifests, globToRegExp, parseManifest } from './manifest';

const LINT_META_RULE_IDS = ['session-epoch-captured'];

function manifest(body: string): string {
  return [
    '---',
    'subsystem: Demo',
    'globs:',
    '  - apps/api/src/demo/*.ts',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

function fixtureWith(files: Readonly<Record<string, string>>): IFixture {
  return createFixture({
    'apps/api/src/demo/demo.service.ts': 'export class DemoService {}\n',
    'packages/eslint-config/nestjs.js':
      "export default [{ rules: { 'repo/demo-fence': 'error' } }];\n",
    ...files,
  });
}

function check(fixture: IFixture) {
  return checkManifests({ root: fixture.root, lintMetaRuleIds: LINT_META_RULE_IDS });
}

describe('parseManifest', () => {
  it('reads the globs and one citation list per invariant heading', () => {
    const parsed = parseManifest(
      'docs/invariants/demo.md',
      manifest(
        '## Invariants\n\n### It holds\n\n**Enforced by:** `lint-meta:session-epoch-captured`, `file:a.ts`\n',
      ),
    );

    assert.equal(parsed.subsystem, 'Demo');
    assert.deepEqual(parsed.globs, ['apps/api/src/demo/*.ts']);
    assert.deepEqual(parsed.invariants[0]?.enforcers, [
      'lint-meta:session-epoch-captured',
      'file:a.ts',
    ]);
  });
});

describe('globToRegExp', () => {
  it('matches a single segment with * and any depth with **', () => {
    assert.ok(globToRegExp('apps/api/src/*.ts').test('apps/api/src/main.ts'));
    assert.ok(!globToRegExp('apps/api/src/*.ts').test('apps/api/src/deep/main.ts'));
    assert.ok(globToRegExp('apps/api/**/*.ts').test('apps/api/src/deep/main.ts'));
  });
});

describe('checkManifests', () => {
  it('accepts a manifest whose globs match and whose citations exist', () => {
    const fixture = fixtureWith({
      'docs/invariants/demo.md': manifest(
        '### It holds\n\n**Enforced by:** `lint-meta:session-epoch-captured`, `eslint:repo/demo-fence`, `file:apps/api/src/demo/demo.service.ts`\n',
      ),
    });

    assert.deepEqual(check(fixture), []);
  });

  it('reports a glob that matches nothing', () => {
    const fixture = fixtureWith({
      'docs/invariants/demo.md': [
        '---',
        'subsystem: Demo',
        'globs:',
        '  - apps/api/src/gone/*.ts',
        '---',
        '',
        '### It holds',
        '',
        '**Enforced by:** `lint-meta:session-epoch-captured`',
        '',
      ].join('\n'),
    });

    const problems = check(fixture);

    assert.equal(problems.length, 1);
    assert.match(problems[0]?.message ?? '', /matches no file/u);
  });

  it('reports a lint-meta rule that is not registered and an ESLint rule that is not configured', () => {
    const fixture = fixtureWith({
      'docs/invariants/demo.md': manifest(
        '### It holds\n\n**Enforced by:** `lint-meta:deleted-rule`, `eslint:repo/never-configured`\n',
      ),
    });

    const messages = check(fixture).map((problem) => problem.message);

    assert.equal(messages.length, 2);
    assert.ok(messages.some((message) => /not in tools\/lint-meta\/registry/u.test(message)));
    assert.ok(messages.some((message) => /does not configure/u.test(message)));
  });

  it('reports a cited file that is gone', () => {
    const fixture = fixtureWith({
      'docs/invariants/demo.md': manifest(
        '### It holds\n\n**Enforced by:** `file:apps/api/src/demo/deleted.spec.ts`\n',
      ),
    });

    assert.match(check(fixture)[0]?.message ?? '', /does not exist/u);
  });

  it('reports an invariant with no Enforced by line, and an unenforced one with no follow-up', () => {
    const fixture = fixtureWith({
      'docs/invariants/demo.md': manifest(
        '### Nothing says\n\nprose only\n\n### Nobody checks\n\n**Enforced by:** `unenforced`\n',
      ),
    });

    const messages = check(fixture).map((problem) => problem.message);

    assert.equal(messages.length, 2);
    assert.ok(messages.some((message) => /has no `\*\*Enforced by:\*\*` line/u.test(message)));
    assert.ok(messages.some((message) => /no follow-up/u.test(message)));
  });

  it('accepts an unenforced invariant that names the issue tracking it', () => {
    const fixture = fixtureWith({
      'docs/invariants/demo.md': manifest(
        '### Nobody checks\n\n**Enforced by:** `unenforced`, tracked on #1\n',
      ),
    });

    assert.deepEqual(check(fixture), []);
  });

  it('skips the README and reports a manifest with no invariants', () => {
    const fixture = fixtureWith({
      'docs/invariants/README.md': '# not a manifest\n',
      'docs/invariants/demo.md': manifest('Some prose, no headings.'),
    });

    const problems = check(fixture);

    assert.equal(problems.length, 1);
    assert.match(problems[0]?.message ?? '', /No invariants/u);
  });
});
