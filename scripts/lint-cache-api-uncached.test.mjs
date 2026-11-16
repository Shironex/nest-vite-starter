import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * Why the api has no `lint:fast`, and the check that keeps it that way.
 *
 * ESLint's `--cache` keys a result on the linted file's content and the
 * resolved config, and on nothing else. The api's type-aware block reads other
 * files through the type checker, so an edit to one file can make ANOTHER,
 * unchanged file newly wrong. That was found on the real tree: deleting the
 * audit call in password-change.service.ts left auth.router.ts cached clean,
 * while a cold run reported `mutation-entry-must-reach-audit` on
 * `AuthRouter.changePassword`.
 *
 * The first case reproduces that class on a scratch tree with the shipped api
 * config and the smallest typed rule that shows it: a callee that starts
 * returning a promise makes its unchanged caller a floating promise. A warm
 * cache misses it. If ESLint ever learns to invalidate on type dependencies,
 * that case fails, and a cached api lint can be reconsidered on evidence.
 *
 * The second is the guard: no api script lints with a cache, and the root
 * `lint:fast` does not select the api.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = join(REPO_ROOT, 'apps', 'api');
const RULE = '@typescript-eslint/no-floating-promises';
const PROBE_DIR = join('src', 'modules', 'lint-cache-probe');
const CALLER = join(PROBE_DIR, 'caller.ts');
const CALLEE = join(PROBE_DIR, 'callee.ts');

const ESLINT_URL = pathToFileURL(
  createRequire(join(API_ROOT, 'package.json')).resolve('eslint'),
).href;

const CALLER_SOURCE = `import { refresh } from './callee';

export function run(): void {
  refresh();
}
`;
const CALLEE_SYNC = 'export function refresh(): void {}\n';
const CALLEE_ASYNC = 'export async function refresh(): Promise<void> {}\n';

const RUNNER = `
const { ESLint } = await import(process.env.PROBE_ESLINT_URL);
const eslint = new ESLint({
  cwd: process.cwd(),
  cache: true,
  cacheLocation: process.env.PROBE_CACHE,
  cacheStrategy: 'content',
});
const [result] = await eslint.lintFiles([process.env.PROBE_FILE]);
const relevant = result.messages.filter((m) => m.fatal || m.ruleId === process.env.PROBE_RULE);
process.stdout.write(JSON.stringify(relevant.map((m) => m.ruleId ?? m.message)));
`;

const scratchRoots = [];
after(() => {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

function scratchTree() {
  const root = mkdtempSync(join(tmpdir(), 'lint-cache-api-'));
  scratchRoots.push(root);
  const api = join(root, 'apps', 'api');
  const schema = join('packages', 'database', 'prisma', 'schema');

  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  cpSync(join(REPO_ROOT, schema), join(root, schema), { recursive: true });
  mkdirSync(join(api, PROBE_DIR), { recursive: true });
  cpSync(join(API_ROOT, 'eslint.config.mjs'), join(api, 'eslint.config.mjs'));
  cpSync(join(API_ROOT, 'tsconfig.json'), join(api, 'tsconfig.json'));
  symlinkSync(join(API_ROOT, 'node_modules'), join(api, 'node_modules'), 'dir');
  writeFileSync(join(api, CALLER), CALLER_SOURCE);
  writeFileSync(join(api, CALLEE), CALLEE_SYNC);
  return { api, cache: join(root, 'eslint-cache') };
}

function lintCaller(tree) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: tree.api,
    encoding: 'utf8',
    env: {
      ...process.env,
      PROBE_ESLINT_URL: ESLINT_URL,
      PROBE_CACHE: tree.cache,
      PROBE_FILE: join(tree.api, CALLER),
      PROBE_RULE: RULE,
    },
  });
  assert.equal(run.status, 0, `eslint run failed:\n${run.stderr}`);
  return JSON.parse(run.stdout);
}

describe('the api lints uncached', () => {
  it('a cached api lint misses a violation made by editing ANOTHER file', () => {
    const tree = scratchTree();
    assert.deepEqual(lintCaller(tree), [], 'the caller is clean while the callee is sync');
    writeFileSync(join(tree.api, CALLEE), CALLEE_ASYNC);

    assert.deepEqual(lintCaller(tree), [], 'warm: the unchanged caller keeps its cached clean');

    rmSync(tree.cache, { force: true });
    assert.ok(lintCaller(tree).includes(RULE), `cold: the same caller is reported by ${RULE}`);
  });

  it('no api script lints with a cache, and the root lint:fast does not select the api', () => {
    const api = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8'));
    for (const [name, command] of Object.entries(api.scripts)) {
      assert.doesNotMatch(command, /--cache\b/u, `apps/api script "${name}" lints with a cache`);
    }
    assert.equal(api.scripts['lint:fast'], undefined, 'apps/api must not define lint:fast');

    const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.doesNotMatch(root.scripts['lint:fast'] ?? '', /@repo\/api/u);
  });
});
