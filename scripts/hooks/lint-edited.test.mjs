import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluate, formatProblems, parseRun } from './lint-edited.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = join(REPO_ROOT, 'scripts', 'hooks', 'lint-edited.mjs');

/** A fixture tree holding one existing file, so `existsSync` passes without real source. */
function fixture(...files) {
  const root = mkdtempSync(join(tmpdir(), 'lint-edited-'));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  return root;
}

const payload = (file) => ({ tool_name: 'Edit', tool_input: { file_path: file } });
const problemFor = (root, file, extra = {}) => ({
  filePath: join(root, file),
  messages: [
    { ruleId: 'no-empty', line: 3, column: 5, message: 'Empty block statement.', ...extra },
  ],
});

describe('lint-edited: evaluate', () => {
  it('returns file:line:col rule message for each problem', () => {
    const file = 'apps/api/src/a.ts';
    const root = fixture(file);
    try {
      const reason = evaluate(payload(file), { root, run: () => [problemFor(root, file)] });
      assert.match(reason, /1 problem\(s\) in apps\/api\/src\/a\.ts/u);
      assert.match(reason, /apps\/api\/src\/a\.ts:3:5 no-empty Empty block statement\./u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs eslint from the touched workspace', () => {
    const file = 'apps/web/src/features/x/X.tsx';
    const root = fixture(file);
    try {
      let seen;
      evaluate(payload(join(root, file)), {
        root,
        run: (_root, workspaceDir, absFile) => {
          seen = { workspaceDir, absFile };
          return [];
        },
      });
      assert.deepEqual(seen, { workspaceDir: join(root, 'apps/web'), absFile: join(root, file) });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is silent for a clean file', () => {
    const file = 'apps/api/src/a.ts';
    const root = fixture(file);
    try {
      assert.equal(
        evaluate(payload(file), {
          root,
          run: () => [{ filePath: join(root, file), messages: [] }],
        }),
        null,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is silent when eslint could not give an answer (missing, config error, timeout)', () => {
    const file = 'apps/api/src/a.ts';
    const root = fixture(file);
    try {
      assert.equal(evaluate(payload(file), { root, run: () => null }), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips files it should not lint without ever calling eslint', () => {
    const root = fixture(
      'apps/api/src/@generated/server.ts',
      'apps/web/src/routeTree.gen.ts',
      'apps/api/README.md',
      'apps/api/eslint.config.mjs',
      'apps/api/dist/main.ts',
      'tools/lint-meta/cli.ts',
      'scripts/hooks/x.ts',
      'apps/web/node_modules/x/index.ts',
    );
    try {
      for (const file of [
        'apps/api/src/@generated/server.ts',
        'apps/web/src/routeTree.gen.ts',
        'apps/api/README.md',
        'apps/api/eslint.config.mjs',
        'apps/api/dist/main.ts',
        'tools/lint-meta/cli.ts',
        'scripts/hooks/x.ts',
        'apps/web/node_modules/x/index.ts',
        'apps/api/src/missing.ts',
        '/etc/hosts',
      ]) {
        const run = () => assert.fail(`eslint must not run for ${file}`);
        assert.equal(evaluate(payload(file), { root, run }), null, file);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores a payload with no file path', () => {
    assert.equal(evaluate({ tool_input: {} }), null);
  });
});

describe('lint-edited: parseRun', () => {
  it('reads results for exit 0 and exit 1', () => {
    assert.deepEqual(parseRun({ status: 0, stdout: '[]' }), []);
    assert.deepEqual(parseRun({ status: 1, stdout: '[{"messages":[]}]' }), [{ messages: [] }]);
  });

  it('proves nothing for a config error, a timeout or unparseable output', () => {
    assert.equal(parseRun({ status: 2, stdout: '[]' }), null);
    assert.equal(parseRun({ status: null, error: new Error('ETIMEDOUT'), stdout: '' }), null);
    assert.equal(parseRun({ status: 0, stdout: 'Oops! Something went wrong' }), null);
  });
});

describe('lint-edited: formatProblems', () => {
  it('names a parse error and caps a long list', () => {
    const root = '/repo';
    const messages = Array.from({ length: 25 }, (_, index) => ({
      ruleId: null,
      fatal: true,
      line: index + 1,
      column: 1,
      message: 'Parsing error',
    }));
    const lines = formatProblems([{ filePath: '/repo/apps/api/src/a.ts', messages }], root);

    assert.equal(lines.length, 21);
    assert.equal(lines[0], 'apps/api/src/a.ts:1:1 parse-error Parsing error');
    assert.equal(lines.at(-1), '... and 5 more');
  });
});

describe('lint-edited: stdin/stdout protocol with the real eslint', { timeout: 240_000 }, () => {
  const ready =
    existsSync(join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js')) &&
    existsSync(join(REPO_ROOT, 'packages', 'eslint-plugin-repo', 'dist', 'index.js'));

  it(
    'blocks with decision:block and the problems, and stays silent on a clean file',
    { skip: !ready },
    () => {
      const dir = join(REPO_ROOT, 'apps', 'api', 'src', '__lint_edited_probe__');
      mkdirSync(dir, { recursive: true });
      try {
        const bad = join(dir, 'bad.ts');
        const good = join(dir, 'good.ts');
        writeFileSync(bad, 'export const a = (b as any).c;\n');
        writeFileSync(good, 'export const a = 1;\n');
        const run = (file) =>
          spawnSync(process.execPath, [HOOK, '--timeout-ms=120000'], {
            input: JSON.stringify(payload(file)),
            encoding: 'utf8',
          });

        const blocked = run(bad);
        assert.equal(blocked.status, 0);
        const { decision, reason } = JSON.parse(blocked.stdout);
        assert.equal(decision, 'block');
        assert.match(reason, /no-explicit-any/u);

        const clean = run(good);
        assert.equal(clean.status, 0);
        assert.equal(clean.stdout, '');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('fails open on malformed input', () => {
    for (const stdin of ['', 'not json']) {
      const result = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, '');
    }
  });
});
