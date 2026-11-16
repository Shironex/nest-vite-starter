import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluate } from './guard-edit.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'guard-edit.mjs');
const API_FILE = 'apps/api/src/modules/example/example.service.ts';

const edit = (file, oldString, newString) => ({
  tool_name: 'Edit',
  tool_input: { file_path: file, old_string: oldString, new_string: newString },
});
const write = (file, content) => ({ tool_name: 'Write', tool_input: { file_path: file, content } });

describe('guard-edit: denies a net-new banned pattern in apps/api/src', () => {
  const cases = [
    ['as any', 'const a = value as any;', 'no-explicit-any'],
    ['as any before a newline', 'const a = value as any\nuse(a);', 'no-explicit-any'],
    ['as any at the end of the text', 'const a = value as any', 'no-explicit-any'],
    ['as any as T', 'const a = value as any as Foo;', 'no-explicit-any'],
    ['as any[]', 'const a = value as any[];', 'no-explicit-any'],
    ['@ts-ignore', '// @ts-ignore\nfoo();', 'no-ts-ignore'],
    ['@ts-expect-error', '// @ts-expect-error legacy\nfoo();', 'no-ts-ignore'],
    [
      'eslint-disable-next-line',
      '// eslint-disable-next-line no-console\nfoo();',
      'no-inline-lint-disable',
    ],
    ['eslint-disable block', '/* eslint-disable */\nfoo();', 'no-inline-lint-disable'],
    ['empty catch', 'try { foo(); } catch {}', 'no-empty'],
    ['empty catch with binding', 'try { foo(); } catch (error) {\n}', 'no-empty'],
  ];

  for (const [name, text, rule] of cases) {
    it(`Edit adding ${name}`, () => {
      const reason = evaluate(edit(API_FILE, 'foo();', text));
      assert.ok(reason, 'expected a deny reason');
      assert.match(reason, new RegExp(rule.replace(/[/]/gu, '\\/')));
    });
  }

  it('Write of a new file', () => {
    assert.ok(evaluate(write('apps/api/src/brand-new.ts', 'export const a = x as any;\n')));
  });

  it('MultiEdit where one edit adds a match', () => {
    const reason = evaluate({
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: API_FILE,
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: '// @ts-ignore\nd' },
        ],
      },
    });
    assert.match(reason ?? '', /no-ts-ignore/u);
  });

  it('reports every rule the edit breaks, with the gate rule message', () => {
    const reason = evaluate(edit(API_FILE, 'x', 'y as any; // @ts-ignore'));
    assert.match(reason, /no-ts-ignore/u);
    assert.match(reason, /no-explicit-any/u);
    assert.match(reason, /Narrow the type or fix the underlying error/u);
  });

  it('denies in apps/web/src and packages/*/src too, and in spec files', () => {
    assert.ok(evaluate(edit('apps/web/src/App.tsx', 'x', 'x as any;')));
    assert.ok(evaluate(edit('packages/shared/src/index.ts', 'x', '// @ts-ignore')));
    assert.ok(evaluate(edit('apps/api/src/foo.spec.ts', 'x', 'x as any;')));
  });

  it('accepts an absolute path inside the repo', () => {
    const absolute = join(dirname(HOOK), '..', '..', API_FILE);
    assert.ok(evaluate(edit(absolute, 'x', 'x as any;')));
  });
});

describe('guard-edit: allows', () => {
  const allowed = [
    ['prose "as any"', '// treat this as any developer knows it\nfoo();'],
    ['prose "as any" mid-sentence in a comment', '// same as any other call'],
    ['a comment line ending in as any', '// cast the value as any'],
    ['as anything', 'const a = value as anything;'],
    ['import * as X', "import * as path from 'node:path';"],
    ['export * as X', "export * as ns from './ns';"],
    ['a non-empty catch', 'try { foo(); } catch (error) { log(error); }'],
    [
      'a catch holding only a comment',
      'try { foo(); } catch {\n  // safe to ignore: best effort\n}',
    ],
  ];

  for (const [name, text] of allowed) {
    it(name, () => {
      assert.equal(evaluate(edit(API_FILE, 'x', text)), null);
    });
  }

  it('generated files', () => {
    for (const file of [
      'apps/api/src/@generated/server.ts',
      'apps/web/src/routeTree.gen.ts',
      'packages/database/src/generated/client.ts',
    ]) {
      assert.equal(
        evaluate(edit(file, 'x', '/* eslint-disable */ x as any; // @ts-ignore')),
        null,
        file,
      );
    }
  });

  it('paths the gate does not scan: tools, scripts, docs, markdown, configs, outside the repo', () => {
    for (const file of [
      'tools/lint-meta/rules/source-text/forbidden-text.ts',
      'scripts/hooks/guard-edit.mjs',
      'docs/notes.md',
      'apps/api/README.md',
      'apps/api/eslint.config.mjs',
      'apps/api/src/notes.md',
      'apps/web/e2e/journey.ts',
      '/etc/hosts',
    ]) {
      assert.equal(evaluate(edit(file, 'x', '// eslint-disable-next-line\nx as any;')), null, file);
    }
  });

  it('a moved existing match (Edit: old and new hold the same count)', () => {
    const line = 'const a = value as any;';
    assert.equal(evaluate(edit(API_FILE, `${line}\nfoo();`, `foo();\n${line}`)), null);
  });

  it('a MultiEdit that moves a match between two edits', () => {
    const reason = evaluate({
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: API_FILE,
        edits: [
          { old_string: '// @ts-ignore\nfoo();', new_string: 'foo();' },
          { old_string: 'bar();', new_string: '// @ts-ignore\nbar();' },
        ],
      },
    });
    assert.equal(reason, null);
  });

  it('a rewrite of an existing file that keeps its existing matches', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-edit-'));
    after(() => rmSync(root, { recursive: true, force: true }));
    const file = 'apps/api/src/legacy.ts';
    mkdirSync(join(root, 'apps/api/src'), { recursive: true });
    writeFileSync(join(root, file), 'export const a = x as any;\n');

    assert.equal(evaluate(write(file, '// header\nexport const a = x as any;\n'), root), null);
    assert.ok(
      evaluate(write(file, 'export const a = x as any;\nexport const b = y as any;\n'), root),
    );
  });

  it('a payload with no file path', () => {
    assert.equal(evaluate({ tool_name: 'Edit', tool_input: {} }), null);
  });
});

describe('guard-edit: stdin/stdout protocol', () => {
  const run = (stdin) => spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });

  it('denies with hookSpecificOutput and exit 0', () => {
    const result = run(JSON.stringify(edit(API_FILE, 'x', 'x as any;')));
    assert.equal(result.status, 0);

    const { hookSpecificOutput } = JSON.parse(result.stdout);
    assert.equal(hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(hookSpecificOutput.permissionDecision, 'deny');
    assert.match(hookSpecificOutput.permissionDecisionReason, /no-explicit-any/u);
  });

  it('prints nothing when the edit is fine', () => {
    const result = run(JSON.stringify(edit(API_FILE, 'x', 'const a = 1;')));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('fails open on malformed input', () => {
    for (const stdin of ['', 'not json', '{"tool_input":']) {
      const result = run(stdin);
      assert.equal(result.status, 0, stdin);
      assert.equal(result.stdout, '', stdin);
    }
  });
});
