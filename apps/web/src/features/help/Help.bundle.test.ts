import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The lazy import is what keeps the tour engine out of first paint, and it is
 * one keystroke from being untrue: a `import { driver } from 'driver.js'` at the
 * top of any file in the entry graph pulls the engine and its stylesheet into
 * first paint.
 *
 * `pnpm size:check` would NOT catch that today. driver.js is small enough to
 * disappear into the budget's current headroom, so the gate would stay green
 * while the claim stopped being true. This test is the assertion that bites,
 * and it reads source text because that is where the mistake is visible.
 */
const SRC = join(import.meta.dirname, '..', '..');
// `import` followed by WHITESPACE, which is the static form. `import(` is the
// dynamic call, and prettier wraps the engine's `Promise.all` so that one of
// its lines legitimately starts with `import('driver.js')`.
const STATIC_IMPORT = /^\s*import\s[^\n]*['"]driver\.js/mu;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

describe('driver.js stays off the first-paint graph', () => {
  it('is never imported statically anywhere in apps/web', () => {
    const offenders = sourceFiles(SRC).filter((path) => {
      if (path.endsWith('Help.bundle.test.ts')) return false;
      return STATIC_IMPORT.test(readFileSync(path, 'utf8'));
    });

    expect(offenders).toEqual([]);
  });

  it('is reached only through a dynamic import, and so is its stylesheet', () => {
    const engine = readFileSync(join(SRC, 'features', 'help', 'Help.engine.ts'), 'utf8');

    expect(engine).toContain("import('driver.js')");
    expect(engine).toContain("import('driver.js/dist/driver.css')");
  });
});
