import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

/*
 * The incremental type-check cache, and the one thing that would make it worth
 * deleting: a warm run that misses an error.
 *
 * Every `check-types` script in the repo is `tsc --noEmit -p <config>`, and
 * `tsBuildInfoFile` does nothing in that form unless `incremental` is also on.
 * The web and package configs named the file and never set the flag, so the
 * flag was added; these two tests are what says the addition is safe.
 *
 * The first proves the property that matters: change a file, and the ERROR IN
 * ITS UNTOUCHED DEPENDENT still appears on the warm run. tsc stores file
 * versions and the reference graph in the buildinfo and re-checks everything
 * downstream of a changed file, so this is a property of tsc rather than of our
 * configs, which is exactly why it is worth pinning. A dropped `incremental`
 * only makes runs slower; a tsc that stopped doing this would make them lie.
 *
 * The second stops the original bug coming back in a new config: a
 * `tsBuildInfoFile` with no `incremental` anywhere in its `extends` chain is
 * dead configuration that reads like a working cache.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSC = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

const FIXTURE_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      incremental: true,
      tsBuildInfoFile: './cache/fixture.tsbuildinfo',
    },
    include: ['src'],
  },
  null,
  2,
);

/** `origin()` returns numbers, so the consumer's arithmetic type checks. */
const SHAPES_CLEAN = [
  'export interface IPoint {',
  '  readonly x: number;',
  '  readonly y: number;',
  '}',
  '',
  'export function origin(): IPoint {',
  '  return { x: 0, y: 0 };',
  '}',
  '',
].join('\n');

/** The same module with `x` widened to a string: only the CONSUMER breaks. */
const SHAPES_BROKEN = SHAPES_CLEAN.replace('readonly x: number;', 'readonly x: string;').replace(
  '{ x: 0, y: 0 }',
  "{ x: '0', y: 0 }",
);

const CONSUMER = [
  "import { origin } from './shapes';",
  '',
  'export const total: number = origin().x + origin().y;',
  '',
].join('\n');

function runTsc(projectDir: string): { readonly status: number; readonly output: string } {
  const result = spawnSync(TSC, ['--noEmit', '-p', 'tsconfig.json'], {
    cwd: projectDir,
    encoding: 'utf8',
  });

  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('incremental type-check cache', () => {
  it('still reports an error in an untouched file when its import changes', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'typecheck-cache-'));
    after(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    mkdirSync(join(projectDir, 'src'), { recursive: true });
    writeFileSync(join(projectDir, 'tsconfig.json'), `${FIXTURE_TSCONFIG}\n`);
    writeFileSync(join(projectDir, 'src', 'shapes.ts'), SHAPES_CLEAN);
    writeFileSync(join(projectDir, 'src', 'consumer.ts'), CONSUMER);

    const cold = runTsc(projectDir);
    assert.equal(cold.status, 0, `cold run should pass, got:\n${cold.output}`);

    const buildInfo = join(projectDir, 'cache', 'fixture.tsbuildinfo');
    assert.ok(existsSync(buildInfo), 'cold run should have written the buildinfo');

    // Only shapes.ts is rewritten. consumer.ts keeps the byte content the warm
    // run already has a cached result for, so a cache that keyed on the linted
    // file alone (the way ESLint's does) would report nothing here.
    writeFileSync(join(projectDir, 'src', 'shapes.ts'), SHAPES_BROKEN);

    const warm = runTsc(projectDir);
    assert.notEqual(warm.status, 0, 'warm run should fail on the introduced type error');
    assert.match(warm.output, /consumer\.ts/u);
    assert.match(warm.output, /error TS/u);
  });

  it('keeps the authoritative gates uncached', () => {
    // `lint:fast` is the local loop and only that. ESLint's cache keys a file's
    // result on that file and its config, so a rule that reads anything else
    // can return a stale verdict; the api's `settings` digest closes the one
    // cross-file read we have, and nothing says a future rule will be covered.
    // CI and the pre-push hook therefore lint cold, and this is what says so.
    const gates = [
      '.github/workflows/ci.yml',
      'scripts/ci/pre-push.sh',
      'scripts/ci/pre-push.manifest.json',
    ];

    for (const gate of gates) {
      const source = readFileSync(join(REPO_ROOT, gate), 'utf8');
      assert.doesNotMatch(
        source,
        /--cache\b|lint:fast/u,
        `${gate} must not lint with a cache: --cache and lint:fast are the local loop, not the gate`,
      );
    }
  });

  it('never names a tsBuildInfoFile without turning `incremental` on', () => {
    const offenders = repoTsconfigs()
      .filter((config) => effectiveOption(config, 'tsBuildInfoFile') !== undefined)
      .filter((config) => effectiveOption(config, 'incremental') !== true)
      .map((config) => relative(REPO_ROOT, config).split(sep).join('/'));

    assert.deepEqual(
      offenders,
      [],
      'these configs name a tsBuildInfoFile that `tsc --noEmit -p` will ignore, because neither they nor anything they extend sets `incremental`',
    );
  });
});

const TSCONFIG_NAME = /^tsconfig(?:\..+)?\.json$/u;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

/** JSONC: tsconfig files carry `//` comments, which JSON.parse rejects. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"\\])\/\/.*$/gmu, '$1');
}

function repoTsconfigs(dir: string = REPO_ROOT, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry) && !entry.startsWith('.')) {
        repoTsconfigs(full, out);
      }
      continue;
    }
    if (TSCONFIG_NAME.test(entry)) {
      out.push(full);
    }
  }

  return out.sort();
}

/**
 * One `compilerOptions` entry, resolved through the `extends` chain the way tsc
 * resolves it: nearest config wins, `@repo/tsconfig/*` is the workspace package.
 */
function effectiveOption(configPath: string, option: string): unknown {
  const seen = new Set<string>();
  let current: string | undefined = configPath;

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripComments(readFileSync(current, 'utf8'))) as Record<string, unknown>;
    } catch {
      return undefined;
    }

    const options = parsed.compilerOptions;
    if (typeof options === 'object' && options !== null && option in options) {
      return (options as Record<string, unknown>)[option];
    }

    const extendsEntry = parsed.extends;
    current = typeof extendsEntry === 'string' ? resolveExtends(current, extendsEntry) : undefined;
  }

  return undefined;
}

/** Only the two forms this repo uses: a relative path, or `@repo/tsconfig/<file>`. */
function resolveExtends(fromConfig: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) {
    const resolved = resolve(dirname(fromConfig), specifier);
    return resolved.endsWith('.json') ? resolved : `${resolved}.json`;
  }

  const PACKAGE_PREFIX = '@repo/tsconfig/';
  if (specifier.startsWith(PACKAGE_PREFIX)) {
    return join(REPO_ROOT, 'packages', 'tsconfig', specifier.slice(PACKAGE_PREFIX.length));
  }

  return undefined;
}
