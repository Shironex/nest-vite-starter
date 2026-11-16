import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * No wall-clock sleeps in the Playwright suite.
 *
 * A sleep is a guess about how long something takes, and it is wrong on both
 * ends: too short on a loaded CI runner (a flake nobody can reproduce) and too
 * long everywhere else (paid for on every run, forever). Playwright already
 * waits for the thing itself, so `expect(...).toPass()`, a web-first assertion
 * or a locator wait says what is actually being waited for.
 *
 * `test.setTimeout(...)` is NOT a sleep: it is a budget for a slow journey, and
 * the suite has eight legitimate ones. The lookbehind is what keeps it allowed
 * while a bare `setTimeout(` and `window`/`globalThis.setTimeout(` stay banned.
 */
const E2E_DIR = join('apps', 'web', 'e2e');

const SLEEP =
  /(?<![\w.])(?:setTimeout|(?:window|globalThis)\.setTimeout)\s*\(|\.waitForTimeout\s*\(/u;

const SKIP_DIRS = new Set(['node_modules', '.auth', 'test-results', 'playwright-report']);

/** A line that is only a comment says nothing about what the spec does at run time. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
}

export function checkNoSleepInE2e(root: string): IViolation[] {
  const files: string[] = [];
  walk(join(root, E2E_DIR), files);

  const violations: IViolation[] = [];

  for (const file of files.sort()) {
    const display = relative(root, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split('\n');

    for (const [index, line] of lines.entries()) {
      if (COMMENT_LINE.test(line) || !SLEEP.test(line)) {
        continue;
      }
      violations.push({
        file: display,
        rule: 'no-sleep-in-e2e',
        message: `Line ${String(index + 1)}: a wall-clock sleep in the e2e suite. Wait for the thing itself instead: a web-first assertion, a locator wait, or \`await expect(async () => { ... }).toPass()\` for a retry loop. \`test.setTimeout(...)\` stays allowed, because a journey budget is not a sleep.`,
      });
    }
  }

  return violations;
}

/** The Playwright suite waits for conditions, never for the clock. */
export const noSleepInE2eRule: IMetaRule = {
  id: 'no-sleep-in-e2e',
  category: 'testing',
  ciCritical: true,
  description:
    'apps/web/e2e must not sleep on the wall clock (setTimeout / waitForTimeout); test.setTimeout is a journey budget and stays allowed.',
  run({ root }: IMetaContext): IViolation[] {
    return checkNoSleepInE2e(root);
  },
};
