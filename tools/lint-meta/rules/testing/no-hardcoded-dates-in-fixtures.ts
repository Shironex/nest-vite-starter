import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * A literal calendar date in a fixture is a date that rots.
 *
 * It reads as a constant and behaves as one until "today" moves past it, and
 * then it lands in a different bucket: a record dated 2026-01-15
 * files under a different agenda window in 2027, and the run fails for a reason
 * that has nothing to do with the change that triggered it.
 *
 * Two answers, and the rule accepts either:
 *
 *   - Derive it, when the value is compared against today. The e2e suite has
 *     `apps/web/e2e/support/dates.ts` for that.
 *   - Name it, when it genuinely is a constant (a birth date, a frozen
 *     `createdAt`). A module-scope `const SCREAMING_NAME = '...'` says what the
 *     date means and leaves one place to change it.
 *
 * Scope is fixture material only: the e2e support helpers, and files that call
 * themselves fixtures. A spec that spells out a date inline is making an
 * assertion about that date, which is a different thing.
 */
const E2E_SUPPORT_DIR = join('apps', 'web', 'e2e', 'support');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

/** A quoted string that opens with `yyyy-MM-dd`, so a full ISO timestamp counts too. */
const DATE_LITERAL = /['"`](\d{4}-\d{2}-\d{2})/u;

/** The named-constant escape hatch: `const SCREAMING_NAME = ...` (a type annotation is fine). */
const NAMED_CONSTANT = /\bconst\s+[A-Z][A-Z0-9_]*\s*(?::[^=]*)?=/u;

/** A line that is only a comment describes the code; it does not fill a form. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u;

/** Whether a repo-relative POSIX path calls itself fixture material. */
export function isFixtureFile(posix: string): boolean {
  return (
    posix.includes('/fixtures/') ||
    /(?:^|[./-])fixtures?\.tsx?$/u.test(basename(posix)) ||
    /\.fixtures?\.tsx?$/u.test(basename(posix))
  );
}

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
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
}

export function checkNoHardcodedDatesInFixtures(ctx: IMetaContext): IViolation[] {
  const support: string[] = [];
  walk(join(ctx.root, E2E_SUPPORT_DIR), support);

  const files = [
    ...support,
    ...ctx.sourceFiles.filter((file) => isFixtureFile(file.split(sep).join('/'))),
  ];

  const violations: IViolation[] = [];

  for (const file of [...new Set(files)].sort()) {
    const display = relative(ctx.root, file).split(sep).join('/');

    for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      const match = DATE_LITERAL.exec(line);
      if (match === null || COMMENT_LINE.test(line) || NAMED_CONSTANT.test(line)) {
        continue;
      }
      violations.push({
        file: display,
        rule: 'no-hardcoded-dates-in-fixtures',
        message: `Line ${String(index + 1)}: the literal date \`${match[1] ?? ''}\` ages relative to "today" and will eventually land in a different bucket than the run that wrote it. Derive it (apps/web/e2e/support/dates.ts) if it is compared against today, or hoist it to a module-scope \`const SCREAMING_NAME\` that says what the date means.`,
      });
    }
  }

  return violations;
}

/** Fixture material derives its dates or names them; it never spells one out inline. */
export const noHardcodedDatesInFixturesRule: IMetaRule = {
  id: 'no-hardcoded-dates-in-fixtures',
  category: 'testing',
  ciCritical: true,
  description:
    'Fixtures (e2e support helpers and *fixtures* files) must not inline a literal yyyy-MM-dd; derive it from today or hoist it to a named constant.',
  run(ctx: IMetaContext): IViolation[] {
    return checkNoHardcodedDatesInFixtures(ctx);
  },
};
