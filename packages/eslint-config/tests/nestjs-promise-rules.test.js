import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as nestjsConfig } from '../nestjs.js';

/*
 * Wiring check for the type-aware promise block in nestjs.js, run
 * through the REAL exported config rather than a RuleTester: the thing under
 * test is that `projectService` resolves a tsconfig for apps/api-shaped source
 * and that the two rules fire there, which a RuleTester with its own parser
 * options would not prove.
 *
 * The fixture project is written to a temp dir at run time, laid out like
 * apps/api (a tsconfig.json and a src/ tree), so the block's `src/**` glob
 * matches exactly as it does for the api. Nothing is committed that the repo's
 * own lint, prettier or type-check would then have to step around.
 */
const PRELUDE = `
export async function fetchThing(): Promise<number> {
  return 1;
}
`;

let root;
let eslint;

function writeSource(relativePath, body) {
  const file = join(root, relativePath);
  writeFileSync(file, `${PRELUDE}\n${body}\n`);
  return file;
}

async function promiseRuleIds(relativePath, body) {
  const file = writeSource(relativePath, body);
  const [result] = await eslint.lintFiles([file]);
  return result.messages
    .map((m) => m.ruleId ?? m.message)
    .filter((id) => id.includes('promise') || !id.includes('/'));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nestjs-promise-rules-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022'],
        types: [],
        strict: true,
        noEmit: true,
      },
      include: ['src'],
    }),
  );
  eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: nestjsConfig });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('nestjs.js type-aware promise rules', () => {
  it('fails an unawaited promise-returning call', async () => {
    const ids = await promiseRuleIds(
      'src/floating.ts',
      'export function run(): void {\n  fetchThing();\n}',
    );
    expect(ids).toEqual(['@typescript-eslint/no-floating-promises']);
  });

  it('fails a bare `void` too: deliberate fire-and-forget goes through detach()', async () => {
    const ids = await promiseRuleIds(
      'src/voided.ts',
      'export function run(): void {\n  void fetchThing();\n}',
    );
    expect(ids).toEqual(['@typescript-eslint/no-floating-promises']);
  });

  it('fails an async callback handed to a void-returning parameter', async () => {
    const ids = await promiseRuleIds(
      'src/misused.ts',
      'export function run(): void {\n  [1].forEach(async () => {\n    await fetchThing();\n  });\n}',
    );
    expect(ids).toEqual(['@typescript-eslint/no-misused-promises']);
  });

  it('passes an awaited call and a handled one', async () => {
    const ids = await promiseRuleIds(
      'src/handled.ts',
      [
        'export async function run(): Promise<void> {',
        '  await fetchThing();',
        '  fetchThing().then(undefined, () => undefined);',
        '}',
      ].join('\n'),
    );
    expect(ids).toEqual([]);
  });

  it('leaves specs alone', async () => {
    const ids = await promiseRuleIds(
      'src/floating.spec.ts',
      'export function run(): void {\n  fetchThing();\n}',
    );
    expect(ids).toEqual([]);
  });
});
