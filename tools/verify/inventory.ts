/*
 * The committed test inventory: which cases exist, per suite, with multiplicity.
 *
 * Nothing else in the repo records that. The coverage ratchets move too little
 * to notice one deleted test, ESLint bans `.only` but lets a tracked `.skip`
 * through, and git's ort merge can interleave two branches' adjacent test bodies with no
 * conflict marker, and no runner notices. A suite
 * that lost a case still exits 0, which is exactly the shape of evidence this
 * harness refuses everywhere else: "we did not check" read as "it passed".
 *
 * So a baseline per suite is committed, and a run is compared against it. Four
 * things are refused, even when the suite is green:
 *
 *   missing     a case in the baseline that the run did not produce
 *   unexpected  a case the run produced that the baseline does not list
 *   duplicate   the same [file, fullName] seen more times than the baseline says
 *   skipped     a case the runner reported as skipped, whatever the baseline says
 *
 * This file is the pure half: shapes, normalization, the diff, acceptance and
 * the merge rule. Everything that spawns, reads a file or talks to git lives in
 * inventory-cli.ts, so all of the judgment is testable without a test run.
 */
import type { IJUnitCase } from '../quality/junit';

/**
 * `cases[file][fullName] = count`. Objects, not tuples, for two reasons: the
 * lookup is the operation every comparison performs, and `JSON.stringify(_,
 * null, 2)` of nested objects is byte-identical to what prettier prints, so an
 * accepted baseline never needs a formatting pass afterwards.
 */
export interface IInventory {
  readonly suite: string;
  readonly cases: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** One case as a run reported it, after normalization. */
export interface IObservedCase {
  readonly file: string;
  readonly fullName: string;
  readonly skipped: boolean;
}

export type FindingKind = 'missing' | 'unexpected' | 'duplicate' | 'skipped' | 'merge-damage';

export interface IFinding {
  readonly kind: FindingKind;
  readonly suite: string;
  readonly file: string;
  readonly fullName: string;
  readonly detail: string;
}

export function emptyInventory(suite: string): IInventory {
  return { suite, cases: {} };
}

/*
 * Normalization. A baseline is only worth having if two runs of the same tree,
 * on two machines, produce the same strings.
 *
 * - The worktree path is replaced by `<root>`: every worktree lives at a
 *   different absolute path, so a title built from __dirname or a tmp path
 *   would differ per checkout and make the whole mechanism noise.
 * - Whitespace runs collapse to one space, so a title wrapped across source
 *   lines reads the same as the runner's own one-line rendering.
 * - `it.each` / `test.each` titles are left as the runner expands them. They
 *   are deterministic when the table is a literal, which is the only form this
 *   repo uses; a table built from a date or a random value has to be fixed at
 *   the source, not normalized away here.
 */
export function normalizeTitle(raw: string, root: string): string {
  const collapsed = raw.replace(/\s+/gu, ' ').trim();
  return root === '' ? collapsed : collapsed.split(root).join('<root>');
}

/**
 * The path a case is filed under: repo-relative, POSIX separators.
 *
 * Each runner reports a different base. jest-junit's `file` attribute is
 * relative to the package (`src/...` under apps/api), vitest names a testsuite
 * by its project-relative path, and Playwright's `classname` is relative to
 * `testDir`. `pathBase` is that suite's base, so all three land on one spelling.
 */
export function normalizeFile(raw: string, pathBase: string): string {
  const cleaned = raw.replace(/\\/gu, '/').replace(/^\.\//u, '');
  const base = pathBase.replace(/\/+$/u, '');
  return base === '' ? cleaned : `${base}/${cleaned}`;
}

export interface IObserveOptions {
  readonly pathBase: string;
  /** Absolute worktree path, replaced by `<root>` in titles. */
  readonly root: string;
}

/*
 * A runner can report a case that is not a test. When a suite-level hook throws,
 * jest emits one synthetic entry per file with this title and no real test
 * behind it.
 *
 * It must never reach a baseline. `--accept` on a red run would record it, and
 * from then on every GREEN run would be reported as having LOST a case, which
 * inverts the whole point: the gate would be demanding that a hook keep
 * failing. That is a confusing round trip nobody needs.
 */
const SYNTHETIC_TITLES = [/^>?\s*Test execution failure\b/u];

export function isSyntheticCase(fullName: string): boolean {
  return SYNTHETIC_TITLES.some((pattern) => pattern.test(fullName));
}

export function observe(
  cases: readonly IJUnitCase[],
  options: IObserveOptions,
): readonly IObservedCase[] {
  return cases
    .map((testCase) => ({
      file: normalizeFile(testCase.file, options.pathBase),
      fullName: normalizeTitle(testCase.name, options.root),
      // `errored` is a case that never got to assert anything, which the inventory
      // treats as present-but-broken: the suite is red anyway, and calling it
      // missing would bury the real failure under a baseline diff.
      skipped: testCase.status === 'skipped',
    }))
    .filter((observed) => !isSyntheticCase(observed.fullName));
}

/** Fold observed cases into the same shape a baseline has. */
export function tally(suite: string, cases: readonly IObservedCase[]): IInventory {
  const counts: Record<string, Record<string, number>> = {};
  for (const observed of cases) {
    const byName = (counts[observed.file] ??= {});
    byName[observed.fullName] = (byName[observed.fullName] ?? 0) + 1;
  }
  return { suite, cases: counts };
}

function countOf(inventory: IInventory, file: string, fullName: string): number {
  return inventory.cases[file]?.[fullName] ?? 0;
}

/** Every [file, fullName] either side knows about, sorted. */
function keysOf(...inventories: readonly IInventory[]): readonly (readonly [string, string])[] {
  const keys = new Map<string, readonly [string, string]>();
  for (const inventory of inventories) {
    for (const [file, byName] of Object.entries(inventory.cases)) {
      for (const fullName of Object.keys(byName)) {
        keys.set(`${file}\u0000${fullName}`, [file, fullName]);
      }
    }
  }
  return [...keys.values()].sort((left, right) =>
    left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0]),
  );
}

/**
 * The comparison. `observed` is a run, `baseline` is what is committed.
 *
 * A skipped case is reported whatever the baseline says and is never
 * acceptable: a tracked `.skip` lints clean, and a case that does not run is
 * not a case. That is the hole this whole file exists to close.
 */
export function diffInventory(
  baseline: IInventory,
  observed: IInventory,
  skipped: readonly IObservedCase[],
): readonly IFinding[] {
  const findings: IFinding[] = [];
  const suite = baseline.suite;

  for (const [file, fullName] of keysOf(baseline, observed)) {
    const want = countOf(baseline, file, fullName);
    const got = countOf(observed, file, fullName);
    if (want === got) {
      continue;
    }
    if (got === 0) {
      findings.push({ kind: 'missing', suite, file, fullName, detail: `expected ${want}, ran 0` });
    } else if (want === 0) {
      findings.push({
        kind: 'unexpected',
        suite,
        file,
        fullName,
        detail: `ran ${got}, not in the baseline`,
      });
    } else {
      findings.push({
        kind: 'duplicate',
        suite,
        file,
        fullName,
        detail: `expected ${want}, ran ${got}${got > want ? ' (a duplicated title runs twice under one name)' : ''}`,
      });
    }
  }

  for (const skip of skipped) {
    findings.push({
      kind: 'skipped',
      suite,
      file: skip.file,
      fullName: skip.fullName,
      detail: 'reported as skipped, which is never evidence',
    });
  }

  return findings;
}

export interface IAcceptance {
  readonly next: IInventory;
  /** Findings `--accept` refused to write, because they remove cases. */
  readonly refused: readonly IFinding[];
}

/**
 * `--accept` writes additions: a new case, or a case seen more times than
 * before. Losing one needs `--allow-removals` on top, because "the test is
 * gone" is the claim this mechanism exists to make someone say out loud.
 *
 * Skipped cases are not acceptance material at all and never reach here.
 */
export function acceptInto(
  baseline: IInventory,
  observed: IInventory,
  allowRemovals: boolean,
): IAcceptance {
  const next: Record<string, Record<string, number>> = {};
  const refused: IFinding[] = [];

  for (const [file, fullName] of keysOf(baseline, observed)) {
    const want = countOf(baseline, file, fullName);
    const got = countOf(observed, file, fullName);
    const removes = got < want;
    const keep = removes && !allowRemovals ? want : got;
    if (removes && !allowRemovals) {
      refused.push({
        kind: got === 0 ? 'missing' : 'duplicate',
        suite: baseline.suite,
        file,
        fullName,
        detail: `expected ${want}, ran ${got}; rerun with --allow-removals to write it`,
      });
    }
    if (keep > 0) {
      (next[file] ??= {})[fullName] = keep;
    }
  }

  return { next: { suite: baseline.suite, cases: next }, refused };
}

/*
 * The merge rule.
 *
 * A merge commit's inventory must be explained by its two parents. Take the
 * three-way merge of the counts: whichever parent moved a case, that is the
 * value the merged tree should carry, and when both moved it differently a
 * human resolved it and either answer is allowed. Anything else appeared (or
 * vanished) during the merge itself, which is what an interleaving merge looks
 * like from outside: two green branches, one damaged tree.
 */
export function expectedAtMerge(base: number, left: number, right: number): number | 'either' {
  if (left === right) {
    return left;
  }
  if (left === base) {
    return right;
  }
  if (right === base) {
    return left;
  }
  return 'either';
}

export interface IMergeSides {
  readonly base: IInventory;
  readonly left: IInventory;
  readonly right: IInventory;
  readonly merged: IInventory;
}

export function auditMerge(suite: string, sides: IMergeSides): readonly IFinding[] {
  const findings: IFinding[] = [];

  for (const [file, fullName] of keysOf(sides.base, sides.left, sides.right, sides.merged)) {
    const base = countOf(sides.base, file, fullName);
    const left = countOf(sides.left, file, fullName);
    const right = countOf(sides.right, file, fullName);
    const merged = countOf(sides.merged, file, fullName);

    const expected = expectedAtMerge(base, left, right);
    const explained =
      expected === 'either' ? merged === left || merged === right : merged === expected;
    if (explained) {
      continue;
    }
    findings.push({
      kind: 'merge-damage',
      suite,
      file,
      fullName,
      detail: `base ${base}, parents ${left} and ${right}, merged ${merged}; neither parent explains ${merged}`,
    });
  }

  return findings;
}

/* Serialization. Sorted, so a diff of a baseline is a diff of the test list. */

export function serializeInventory(inventory: IInventory): string {
  const cases: Record<string, Record<string, number>> = {};
  for (const file of Object.keys(inventory.cases).sort((a, b) => a.localeCompare(b))) {
    const byName = inventory.cases[file] ?? {};
    const sorted: Record<string, number> = {};
    for (const fullName of Object.keys(byName).sort((a, b) => a.localeCompare(b))) {
      sorted[fullName] = byName[fullName] ?? 0;
    }
    cases[file] = sorted;
  }
  return `${JSON.stringify({ suite: inventory.suite, cases }, null, 2)}\n`;
}

export function parseInventory(text: string, suite: string): IInventory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${suite}: baseline is not JSON`, { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${suite}: baseline is not an object`);
  }
  const body = parsed as { suite?: unknown; cases?: unknown };
  if (body.suite !== suite) {
    throw new Error(`${suite}: baseline names suite "${String(body.suite)}"`);
  }
  if (typeof body.cases !== 'object' || body.cases === null) {
    throw new Error(`${suite}: baseline has no cases object`);
  }

  const cases: Record<string, Record<string, number>> = {};
  for (const [file, byName] of Object.entries(body.cases as Record<string, unknown>)) {
    if (typeof byName !== 'object' || byName === null) {
      throw new Error(`${suite}: baseline entry for ${file} is not an object`);
    }
    const counts: Record<string, number> = {};
    for (const [fullName, count] of Object.entries(byName as Record<string, unknown>)) {
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
        throw new Error(`${suite}: ${file} :: ${fullName} has a non-count value`);
      }
      counts[fullName] = count;
    }
    cases[file] = counts;
  }
  return { suite, cases };
}

export function totalCases(inventory: IInventory): number {
  return Object.values(inventory.cases).reduce(
    (total, byName) => total + Object.values(byName).reduce((sum, count) => sum + count, 0),
    0,
  );
}

export function formatFindings(findings: readonly IFinding[]): string {
  return findings
    .map(
      (finding) =>
        `  [${finding.kind}] ${finding.suite} :: ${finding.file}\n      ${finding.fullName}\n      ${finding.detail}`,
    )
    .join('\n');
}
