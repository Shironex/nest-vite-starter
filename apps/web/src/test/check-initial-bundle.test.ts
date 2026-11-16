import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Tests for `scripts/check-initial-bundle.mjs`, the gate that measures what a
 * browser downloads before first paint.
 *
 * It lives here rather than beside the script because the repo has no root test
 * runner, and this is the budget for THIS app. `src/test/**` is excluded from
 * the coverage ratchet, which is correct: build tooling should be tested but
 * should not be counted as application coverage.
 *
 * The point of most of these cases is that a byte gate whose parser silently
 * matches nothing reports a tiny number and passes forever. That failure mode
 * is invisible precisely when it matters, so it is asserted directly.
 */

const SCRIPT = resolve(__dirname, '../../../../scripts/check-initial-bundle.mjs');

/**
 * Runs the checker and returns its exit code plus combined output.
 *
 * `env` is spread over a copy of the parent environment with CI removed, so a
 * case that does not ask for CI gets the local behavior whether or not the
 * suite itself is running on a CI runner.
 */
function run(
  distDir: string,
  limitKb: number | string,
  env: Record<string, string> = {},
): { code: number; output: string } {
  const { CI: _ci, ...parentEnv } = process.env;
  try {
    const output = execFileSync('node', [SCRIPT, distDir, '--limit', String(limitKb)], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...parentEnv, ...env },
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, output: `${failure.stdout}${failure.stderr}` };
  }
}

let root: string;

/** Writes a dist tree and returns its path. `html` is the document verbatim. */
function makeDist(name: string, html: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

// Incompressible-ish padding, so a "kB" assertion is not at the mercy of brotli
// collapsing a repeated string to nothing.
const padding = (n: number) =>
  Array.from({ length: n }, (_, i) => `export const v${i} = ${Math.sin(i) * 1e9};`).join('\n');

const ENTRY_AND_PRELOAD = [
  '<html><head>',
  '<script type="module" src="./assets/index-abc.js"></script>',
  '<link rel="modulepreload" href="./assets/vendor-def.js">',
  '</head></html>',
].join('');

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'initial-bundle-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-initial-bundle', () => {
  it('sums the entry and its modulepreload set, and passes under the limit', () => {
    const dist = makeDist('happy', ENTRY_AND_PRELOAD, {
      'assets/index-abc.js': padding(200),
      'assets/vendor-def.js': padding(200),
    });

    const { code, output } = run(dist, 500);

    expect(code).toBe(0);
    expect(output).toContain('initial load:');
    expect(output).toContain('across 2 files');
    expect(output).toContain('assets/index-abc.js');
    expect(output).toContain('assets/vendor-def.js');
    expect(output).toContain('headroom');
  });

  it('fails, and says by how much, when the initial load is over budget', () => {
    // Sized to clear the 1 kB limit and no more: the checker runs brotli at
    // quality 11, so every extra kB of padding is compression time, and at
    // 4000 lines per file this case sat on the 5s timeout.
    const dist = makeDist('over', ENTRY_AND_PRELOAD, {
      'assets/index-abc.js': padding(200),
      'assets/vendor-def.js': padding(200),
    });

    const { code, output } = run(dist, 1);

    expect(code).toBe(1);
    expect(output).toContain('Over budget by');
    // The gate has to argue for the honest fix, or the next person raises the
    // number and moves on, which is how the old all-chunks budget died.
    expect(output).toContain('Raising the limit does not');
  });

  it('counts a chunk only once when it is both preloaded and scripted', () => {
    const dist = makeDist(
      'dedupe',
      '<html><script type="module" src="./assets/index-abc.js"></script>' +
        '<link rel="modulepreload" href="./assets/index-abc.js">' +
        '<link rel="modulepreload" href="./assets/vendor-def.js"></html>',
      { 'assets/index-abc.js': padding(50), 'assets/vendor-def.js': padding(50) },
    );

    const { code, output } = run(dist, 500);

    expect(code).toBe(0);
    expect(output).toContain('across 2 files');
  });

  it('measures the same set whether the build used a relative or absolute base', () => {
    const files = { 'assets/index-abc.js': padding(200), 'assets/vendor-def.js': padding(200) };
    const relative = makeDist('base-relative', ENTRY_AND_PRELOAD, files);
    const absolute = makeDist(
      'base-absolute',
      ENTRY_AND_PRELOAD.replace(/\.\/assets/g, '/assets'),
      files,
    );

    const sizeOf = (output: string) => /initial load: ([\d.]+) kB/.exec(output)?.[1];

    const first = run(relative, 500);
    const second = run(absolute, 500);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    // `vite build` uses a relative base for the Electron file:// shell but an
    // absolute one for the preview-served e2e run. The budget must not move.
    expect(sizeOf(first.output)).toBe(sizeOf(second.output));
  });

  it('ignores cross-origin scripts, which are not bytes we ship', () => {
    const dist = makeDist(
      'cross-origin',
      '<html><script type="module" src="./assets/index-abc.js"></script>' +
        '<script src="https://cdn.example.com/analytics.js"></script>' +
        '<link rel="modulepreload" href="./assets/vendor-def.js"></html>',
      { 'assets/index-abc.js': padding(50), 'assets/vendor-def.js': padding(50) },
    );

    const { code, output } = run(dist, 500);

    expect(code).toBe(0);
    expect(output).toContain('across 2 files');
  });

  it('counts the render-blocking stylesheet, which has the strongest claim on first paint', () => {
    const dist = makeDist(
      'stylesheet',
      '<html><head>' +
        '<script type="module" src="./assets/index-abc.js"></script>' +
        '<link rel="modulepreload" href="./assets/vendor-def.js">' +
        '<link rel="stylesheet" crossorigin href="./assets/index-ghi.css">' +
        '</head></html>',
      {
        'assets/index-abc.js': padding(50),
        'assets/vendor-def.js': padding(50),
        'assets/index-ghi.css': padding(400),
      },
    );

    const { code, output } = run(dist, 500);

    expect(code).toBe(0);
    expect(output).toContain('across 3 files');
    expect(output).toContain('assets/index-ghi.css');
  });

  it('does not require a stylesheet, since a build may inline its CSS', () => {
    const dist = makeDist('no-stylesheet', ENTRY_AND_PRELOAD, {
      'assets/index-abc.js': padding(50),
      'assets/vendor-def.js': padding(50),
    });

    const { code, output } = run(dist, 500);

    expect(code).toBe(0);
    expect(output).toContain('across 2 files');
  });

  it('refuses to measure a document with no modulepreload set', () => {
    // The silent-underreport case: the parser matches the entry, misses every
    // preload, reports a fraction of the real weight, and passes forever.
    const dist = makeDist(
      'no-preload',
      '<html><script type="module" src="./assets/index-abc.js"></script></html>',
      { 'assets/index-abc.js': padding(50) },
    );

    const { code, output } = run(dist, 500);

    expect(code).toBe(1);
    expect(output).toContain('no <link rel="modulepreload">');
  });

  it('refuses to measure a document with no script at all', () => {
    const dist = makeDist('no-script', '<html><body>nothing</body></html>', {});

    const { code, output } = run(dist, 500);

    expect(code).toBe(1);
    expect(output).toContain('no <script src>');
  });

  it('fails when the document references a file the build did not emit', () => {
    const dist = makeDist('missing', ENTRY_AND_PRELOAD, {
      'assets/index-abc.js': padding(50),
      // vendor-def.js deliberately absent
    });

    const { code, output } = run(dist, 500);

    expect(code).toBe(1);
    expect(output).toContain('not in the build');
    expect(output).toContain('vendor-def.js');
  });

  it('fails when there is no build to measure', () => {
    const { code, output } = run(join(root, 'never-built'), 500);

    expect(code).toBe(1);
    expect(output).toContain('Build the app before checking its budget');
  });

  it.each([['0'], ['-5'], ['abc'], ['']])('rejects the invalid limit %j', (limit) => {
    const dist = makeDist(`limit-${limit || 'empty'}`, ENTRY_AND_PRELOAD, {
      'assets/index-abc.js': padding(50),
      'assets/vendor-def.js': padding(50),
    });

    const { code, output } = run(dist, limit);

    expect(code).toBe(1);
    expect(output).toContain('Invalid --limit');
  });
});

/*
 * The staleness precondition, in its own describe block on purpose.
 *
 * These build their own package-shaped tree (`<pkg>/src` next to `<pkg>/dist`)
 * because that adjacency is exactly what the check looks for, and the fixtures
 * above deliberately have no `src` sibling.
 */
describe('check-initial-bundle staleness precondition', () => {
  let stale: string;

  /**
   * A `<pkg>` directory holding `src/app.ts` and a `dist` built `ageMs`
   * milliseconds after (positive) or before (negative) that source. Returns the
   * dist path.
   */
  function makePackage(name: string, ageMs: number): string {
    const pkg = join(stale, name);
    const dist = join(pkg, 'dist');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    mkdirSync(join(dist, 'assets'), { recursive: true });

    const sourceFile = join(pkg, 'src', 'app.ts');
    writeFileSync(sourceFile, 'export const app = 1;\n');
    writeFileSync(join(dist, 'index.html'), ENTRY_AND_PRELOAD);
    writeFileSync(join(dist, 'assets', 'index-abc.js'), padding(50));
    writeFileSync(join(dist, 'assets', 'vendor-def.js'), padding(50));

    // Set the times explicitly: writing in order is not enough, because a fast
    // filesystem can stamp both files the same millisecond and the comparison
    // is strict.
    const sourceAt = new Date('2026-01-01T00:00:00Z');
    utimesSync(sourceFile, sourceAt, sourceAt);
    const builtAt = new Date(sourceAt.getTime() + ageMs);
    for (const file of ['index.html', 'assets/index-abc.js', 'assets/vendor-def.js']) {
      utimesSync(join(dist, file), builtAt, builtAt);
    }

    return dist;
  }

  beforeAll(() => {
    stale = mkdtempSync(join(tmpdir(), 'initial-bundle-stale-'));
  });

  afterAll(() => {
    rmSync(stale, { recursive: true, force: true });
  });

  it('refuses to weigh a dist older than its sources', () => {
    // The whole point: index.html existing is not evidence that the number
    // describes this commit, and a number for another commit passes silently.
    const dist = makePackage('behind', -60_000);

    const { code, output } = run(dist, 500);

    expect(code).toBe(1);
    expect(output).toContain('is older than its sources');
    expect(output).toContain('turbo build');
  });

  it('measures a dist newer than its sources', () => {
    const dist = makePackage('fresh', 60_000);

    const { code, output } = run(dist, 500);

    expect(code).toBe(0);
    expect(output).toContain('initial load');
  });

  it('skips the comparison under CI, where the workflow guarantees the order', () => {
    // CI mtimes come from a checkout plus a possible turbo cache restore, so a
    // stale-looking dist there says nothing about the bytes.
    const dist = makePackage('behind-on-ci', -60_000);

    const { code, output } = run(dist, 500, { CI: '1' });

    expect(code).toBe(0);
    expect(output).toContain('initial load');
  });
});
