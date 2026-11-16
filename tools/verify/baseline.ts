/*
 * The differential gate: grade a lane on the failures it INTRODUCED, not on
 * whatever the base commit was already failing.
 *
 * Both halves of the problem are common. A red base gets blamed on the branch
 * (an e2e failure looks like a regression until someone re-runs it on
 * origin/main), and a branch that scopes its verification to its own packages
 * reports green into a merged tree that is red. The manual answer to the first is "reproduce on the base before
 * blaming your change", which costs a checkout and a rerun every time; this
 * file is that answer written down once, as data.
 *
 * Three rules hold the whole thing up:
 *
 *   1. A red baseline stops the work. Red checks are listed, and a red check is
 *      only ever subtracted when the baseline itself RECORDS someone saying so
 *      by name. Nothing here silently ignores a failure.
 *   2. The comparison is a counted multiset, not a set. A lane that adds a
 *      second copy of a violation already present in a file raises a count, and
 *      raising a count fails, so "it was already like that" cannot absorb new
 *      work.
 *   3. THE DIFFERENTIAL GATE NEVER REPLACES THE ABSOLUTE GATE. See
 *      ABSOLUTE_GATE_NOTICE below: it is printed on every grade, because a
 *      mechanism that says "this lane added nothing" is a foot-gun the moment
 *      somebody reads it as "this tree is good".
 *
 * This file is the pure half: shapes, keys, the diff, the grade and the
 * serialization, all testable without running a check. Everything that spawns a
 * command or reads a report is in baseline-sources.ts, and the CLI surface is
 * baseline-cli.ts.
 */
import type { CheckStatus, ICheckResult, Profile } from './result';

export const BASELINE_SCHEMA_VERSION = 1;

/**
 * Printed by every grade, pass or fail.
 *
 * A differential pass is a statement about ONE branch against ONE base: this
 * lane added no new violation. It is not a statement about the merged tree, and
 * two lanes that each add nothing can still merge into a tree that fails.
 */
export const ABSOLUTE_GATE_NOTICE =
  'A differential pass is NOT a merge gate. It says only that this branch adds no ' +
  'violation its base did not already have. The merged tree still has to survive ' +
  '`pnpm verify --profile=release`, green or identical to the acknowledged baseline.';

/**
 * Which check produced a violation, and therefore how its key is built.
 *
 * `test` is the odd one: its key is `(file, fullName)` plus the non-passing
 * status, so it is stored as rule = the status the runner reported and message
 * = the case's full name. That keeps one key shape across all four kinds, and
 * it means a case that goes from failing to erroring reads as a new key rather
 * than as the same problem.
 */
export type FindingKind = 'eslint' | 'lint-meta' | 'tsc' | 'test';

export const FINDING_KINDS: readonly FindingKind[] = ['eslint', 'lint-meta', 'tsc', 'test'];

export interface IFinding {
  readonly kind: FindingKind;
  /** Repo-relative, POSIX separators. `(global)` for a diagnostic with no file. */
  readonly file: string;
  /** ESLint rule id, lint-meta rule name, TS error code, or test status. */
  readonly rule: string;
  /**
   * The normalized message, or, for a test, the case's full name.
   *
   * No line or column anywhere: they shift under edits made somewhere else in
   * the file, and a key that moves on its own turns the whole comparison into
   * noise the first time anyone adds an import.
   */
  readonly message: string;
}

export interface ICountedFinding extends IFinding {
  readonly count: number;
}

const SEPARATOR = '\u0000';

export function findingKey(finding: IFinding): string {
  return [finding.kind, finding.file, finding.rule, finding.message].join(SEPARATOR);
}

/** One line naming a finding, short enough to read in a list of them. */
export function formatFinding(finding: IFinding): string {
  const rule = finding.rule === '' ? '(no rule)' : finding.rule;
  return `[${finding.kind}] ${finding.file}\n      ${rule}: ${finding.message}`;
}

function compareFindings(left: IFinding, right: IFinding): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.file.localeCompare(right.file) ||
    left.rule.localeCompare(right.rule) ||
    left.message.localeCompare(right.message)
  );
}

/** Fold findings into counted, sorted entries: the multiset this file compares. */
export function tallyFindings(findings: readonly IFinding[]): readonly ICountedFinding[] {
  const counts = new Map<string, ICountedFinding>();
  for (const finding of findings) {
    const key = findingKey(finding);
    const seen = counts.get(key);
    counts.set(key, { ...finding, count: (seen?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort(compareFindings);
}

export function totalFindings(findings: readonly ICountedFinding[]): number {
  return findings.reduce((total, finding) => total + finding.count, 0);
}

/* The record a source leaves behind, so "we did not look" is never a pass. */

export type SourceStatus = 'collected' | 'blocked';

const SOURCE_STATUSES: readonly SourceStatus[] = ['collected', 'blocked'];
const CHECK_STATUSES: readonly CheckStatus[] = ['passed', 'failed', 'blocked', 'not_applicable'];
const PROFILES: readonly Profile[] = ['static', 'feature', 'release'];

export interface ISourceRecord {
  readonly id: string;
  readonly status: SourceStatus;
  /** Why it is blocked, or what it found. */
  readonly reason: string;
  readonly count: number;
}

export interface ICollection {
  readonly commit: string;
  readonly fingerprint: string;
  readonly findings: readonly ICountedFinding[];
  readonly sources: readonly ISourceRecord[];
}

export function blockedSources(sources: readonly ISourceRecord[]): readonly ISourceRecord[] {
  return sources.filter((source) => source.status === 'blocked');
}

/* The baseline document. */

/**
 * A red check somebody decided to carry, named out loud.
 *
 * The acknowledgment lives in the baseline FILE, not in a flag passed at grade
 * time, so "we knew about that one" is a recorded claim with a reason attached
 * rather than something a later command can assert about itself.
 */
export interface IAcknowledgement {
  readonly check: string;
  readonly reason: string;
  readonly acknowledgedAt: string;
}

export interface IBaseline {
  readonly schemaVersion: number;
  readonly capturedAt: string;
  /** The commit the baseline describes. The file is named after it. */
  readonly baseSha: string;
  readonly fingerprint: string;
  readonly profile: Profile;
  /** The `pnpm verify` evidence, check by check. */
  readonly checks: readonly ICheckResult[];
  readonly acknowledged: readonly IAcknowledgement[];
  readonly findings: readonly ICountedFinding[];
  readonly sources: readonly ISourceRecord[];
}

export interface IBaselineInput {
  readonly capturedAt: Date;
  readonly baseSha: string;
  readonly fingerprint: string;
  readonly profile: Profile;
  readonly checks: readonly ICheckResult[];
  readonly acknowledged: readonly IAcknowledgement[];
  readonly findings: readonly ICountedFinding[];
  readonly sources: readonly ISourceRecord[];
}

export function buildBaseline(input: IBaselineInput): IBaseline {
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    capturedAt: input.capturedAt.toISOString(),
    baseSha: input.baseSha,
    fingerprint: input.fingerprint,
    profile: input.profile,
    checks: input.checks,
    acknowledged: input.acknowledged,
    findings: input.findings,
    sources: input.sources,
  };
}

/* Reviewing a baseline: is this tree fit to measure a branch against? */

export interface IBaselineReview {
  /** True only when nothing is red, blocked or acknowledged-but-not-red. */
  readonly ok: boolean;
  /** Every check that did not pass. */
  readonly red: readonly ICheckResult[];
  /** Red checks nobody has named. These stop the work. */
  readonly unacknowledged: readonly ICheckResult[];
  /** Red checks somebody named, with a reason. Inherited, never subtracted silently. */
  readonly acknowledged: readonly IAcknowledgement[];
  /** Acknowledgments for checks that are not red: someone is describing another tree. */
  readonly stale: readonly IAcknowledgement[];
  /** Sources that produced no keys, so nothing can be subtracted for them. */
  readonly blocked: readonly ISourceRecord[];
}

export function reviewBaseline(baseline: IBaseline): IBaselineReview {
  const red = baseline.checks.filter(
    (check) => check.status === 'failed' || check.status === 'blocked',
  );
  const named = new Set(baseline.acknowledged.map((entry) => entry.check));
  const redIds = new Set(red.map((check) => check.id));

  const unacknowledged = red.filter((check) => !named.has(check.id));
  const acknowledged = baseline.acknowledged.filter((entry) => redIds.has(entry.check));
  const stale = baseline.acknowledged.filter((entry) => !redIds.has(entry.check));
  const blocked = blockedSources(baseline.sources);

  return {
    ok: unacknowledged.length === 0 && stale.length === 0 && blocked.length === 0,
    red,
    unacknowledged,
    acknowledged,
    stale,
    blocked,
  };
}

/**
 * Record a decision to carry a red check.
 *
 * Refuses a check that is not red, and refuses one that is already named:
 * re-acknowledging would quietly overwrite the first reason, and the reason is
 * the entire value of the record.
 */
export function acknowledgeInto(
  baseline: IBaseline,
  check: string,
  reason: string,
  at: Date,
): IBaseline {
  const target = baseline.checks.find((candidate) => candidate.id === check);
  if (target === undefined) {
    throw new Error(
      `No check "${check}" in this baseline. It ran: ${baseline.checks.map((c) => c.id).join(', ')}.`,
    );
  }
  if (target.status !== 'failed' && target.status !== 'blocked') {
    throw new Error(
      `Check "${check}" is ${target.status} in this baseline; there is nothing to acknowledge.`,
    );
  }
  if (baseline.acknowledged.some((entry) => entry.check === check)) {
    throw new Error(`Check "${check}" is already acknowledged in this baseline.`);
  }
  if (reason.trim() === '') {
    throw new Error(
      `Acknowledging "${check}" needs a reason: it is the whole point of the record.`,
    );
  }

  return {
    ...baseline,
    acknowledged: [
      ...baseline.acknowledged,
      { check, reason: reason.trim(), acknowledgedAt: at.toISOString() },
    ].sort((left, right) => left.check.localeCompare(right.check)),
  };
}

/* The diff. */

export interface IKeyDelta {
  readonly finding: IFinding;
  readonly baseline: number;
  readonly current: number;
}

export interface IBaselineDiff {
  /** Keys the base did not have at all. */
  readonly introduced: readonly IKeyDelta[];
  /** Keys the base had, seen more times now. A second copy of an old violation. */
  readonly raised: readonly IKeyDelta[];
  /** Keys seen fewer times, or gone. Reported as a bonus, never required. */
  readonly fixed: readonly IKeyDelta[];
  /** Keys carried unchanged from the base. What "inherited" means. */
  readonly inherited: readonly IKeyDelta[];
}

function indexByKey(findings: readonly ICountedFinding[]): Map<string, ICountedFinding> {
  return new Map(findings.map((finding) => [findingKey(finding), finding]));
}

export function diffFindings(
  baseline: readonly ICountedFinding[],
  current: readonly ICountedFinding[],
): IBaselineDiff {
  const before = indexByKey(baseline);
  const after = indexByKey(current);

  const introduced: IKeyDelta[] = [];
  const raised: IKeyDelta[] = [];
  const fixed: IKeyDelta[] = [];
  const inherited: IKeyDelta[] = [];

  const keys = [...new Set([...before.keys(), ...after.keys()])];
  for (const key of keys) {
    const was = before.get(key);
    const is = after.get(key);
    const finding: IFinding = was ?? is ?? { kind: 'eslint', file: '', rule: '', message: '' };
    const delta: IKeyDelta = { finding, baseline: was?.count ?? 0, current: is?.count ?? 0 };

    if (delta.current > delta.baseline) {
      (delta.baseline === 0 ? introduced : raised).push(delta);
    } else if (delta.current < delta.baseline) {
      fixed.push(delta);
    } else {
      inherited.push(delta);
    }
  }

  const sorted = (deltas: IKeyDelta[]): IKeyDelta[] =>
    deltas.sort((left, right) => compareFindings(left.finding, right.finding));

  return {
    introduced: sorted(introduced),
    raised: sorted(raised),
    fixed: sorted(fixed),
    inherited: sorted(inherited),
  };
}

/* The grade. */

export type Grade = 'passed' | 'failed' | 'blocked';

export interface IGrade {
  readonly grade: Grade;
  readonly reason: string;
  readonly diff: IBaselineDiff;
  /** Sources that could not be collected on either side. Always `blocked`. */
  readonly blocked: readonly ISourceRecord[];
  readonly review: IBaselineReview;
}

export function gradeExitCode(grade: Grade): number {
  switch (grade) {
    case 'passed':
      return 0;
    case 'failed':
      return 1;
    case 'blocked':
      return 2;
  }
}

/**
 * Grade one branch against a baseline.
 *
 * Fails closed in three ways before it ever looks at the diff: a baseline whose
 * own reds were never reviewed grades `blocked`, a source that could not be
 * collected on either side grades `blocked` (nothing can be subtracted for a
 * check nobody ran), and only then do new and raised keys decide pass or fail.
 */
export function gradeAgainstBaseline(baseline: IBaseline, current: ICollection): IGrade {
  const review = reviewBaseline(baseline);
  const diff = diffFindings(baseline.findings, current.findings);
  const blocked = [...review.blocked, ...blockedSources(current.sources)];

  if (!review.ok && review.blocked.length === 0) {
    return {
      grade: 'blocked',
      reason:
        review.unacknowledged.length > 0
          ? `the baseline is red and unacknowledged: ${review.unacknowledged.map((c) => c.id).join(', ')}`
          : `the baseline acknowledges ${review.stale.map((a) => a.check).join(', ')}, which is not red in it`,
      diff,
      blocked,
      review,
    };
  }
  if (blocked.length > 0) {
    return {
      grade: 'blocked',
      reason: `no evidence from: ${blocked.map((source) => source.id).join(', ')}`,
      diff,
      blocked,
      review,
    };
  }

  const introduced = diff.introduced.length;
  const raised = diff.raised.length;
  if (introduced + raised > 0) {
    return {
      grade: 'failed',
      reason: `${String(introduced)} new key(s), ${String(raised)} raised count(s)`,
      diff,
      blocked,
      review,
    };
  }

  return {
    grade: 'passed',
    reason:
      diff.fixed.length > 0
        ? `no new violation; ${String(diff.fixed.length)} fixed`
        : 'no new violation',
    diff,
    blocked,
    review,
  };
}

/* Output. The gate is only worth having if a failure explains itself. */

function deltaLines(title: string, deltas: readonly IKeyDelta[], showCounts: boolean): string[] {
  if (deltas.length === 0) {
    return [];
  }
  return [
    `${title} (${String(deltas.length)}):`,
    ...deltas.map((delta) => {
      const counts = showCounts ? ` [${String(delta.baseline)} -> ${String(delta.current)}]` : '';
      return `  ${formatFinding(delta.finding)}${counts}`;
    }),
  ];
}

export function formatDiff(diff: IBaselineDiff): string {
  return [
    ...deltaLines('NEW, and not in the base', diff.introduced, false),
    ...deltaLines('MORE of a violation the base already had', diff.raised, true),
    ...deltaLines('fixed by this branch (a bonus, not required)', diff.fixed, true),
  ].join('\n');
}

export function formatReview(review: IBaselineReview): string {
  const lines: string[] = [];
  if (review.unacknowledged.length > 0) {
    lines.push(
      `RED BASELINE. ${String(review.unacknowledged.length)} check(s) do not pass on the base commit:`,
      ...review.unacknowledged.map((check) => `  ${check.status} ${check.id}: ${check.reason}`),
      'Fix the base, or acknowledge each one by name:',
      ...review.unacknowledged.map(
        (check) => `  pnpm verify:baseline acknowledge --check=${check.id} --reason="..."`,
      ),
    );
  }
  if (review.stale.length > 0) {
    lines.push(
      'Acknowledgments that name a check which is not red here:',
      ...review.stale.map((entry) => `  ${entry.check}: ${entry.reason}`),
    );
  }
  if (review.blocked.length > 0) {
    lines.push(
      'Sources the baseline could not collect, so nothing can be subtracted for them:',
      ...review.blocked.map((source) => `  ${source.id}: ${source.reason}`),
    );
  }
  if (review.acknowledged.length > 0) {
    lines.push(
      `Inherited red, carried on purpose (${String(review.acknowledged.length)}):`,
      ...review.acknowledged.map((entry) => `  ${entry.check}: ${entry.reason}`),
    );
  }
  return lines.join('\n');
}

/* Serialization. Sorted, so two captures of one tree are byte-identical. */

export function serializeBaseline(baseline: IBaseline): string {
  return `${JSON.stringify(
    {
      ...baseline,
      checks: [...baseline.checks].sort((left, right) => left.id.localeCompare(right.id)),
      acknowledged: [...baseline.acknowledged].sort((left, right) =>
        left.check.localeCompare(right.check),
      ),
      findings: [...baseline.findings].sort(compareFindings),
      sources: [...baseline.sources].sort((left, right) => left.id.localeCompare(right.id)),
    },
    null,
    2,
  )}\n`;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`baseline: ${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`baseline: ${what} is not an array`);
  }
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new Error(`baseline: ${what} is not a string`);
  }
  return value;
}

/** One of `known`, or a throw. `find` rather than a cast, so the type follows the check. */
function asMember<T extends string>(value: unknown, known: readonly T[], what: string): T {
  const text = asString(value, what);
  const member = known.find((candidate) => candidate === text);
  if (member === undefined) {
    throw new Error(`baseline: ${what} is "${text}", not one of ${known.join(', ')}`);
  }
  return member;
}

function parseFinding(value: unknown, index: number): ICountedFinding {
  const entry = asRecord(value, `findings[${String(index)}]`);
  const count = entry['count'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    throw new Error(`baseline: findings[${String(index)}] has a non-count value`);
  }
  return {
    kind: asMember(entry['kind'], FINDING_KINDS, `findings[${String(index)}].kind`),
    file: asString(entry['file'], `findings[${String(index)}].file`),
    rule: asString(entry['rule'], `findings[${String(index)}].rule`),
    message: asString(entry['message'], `findings[${String(index)}].message`),
    count,
  };
}

/**
 * Read a baseline back, strictly.
 *
 * A baseline that half-parses is worse than none: it would subtract keys it
 * happened to understand and grade a lane green on the rest.
 */
export function parseBaseline(text: string): IBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error('baseline: not JSON', { cause: error });
  }
  const body = asRecord(parsed, 'document');

  const version = body['schemaVersion'];
  if (version !== BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `baseline: schemaVersion ${String(version)}, this build reads ${String(BASELINE_SCHEMA_VERSION)}. Recapture it.`,
    );
  }

  const checks = asArray(body['checks'], 'checks').map((value, index) => {
    const entry = asRecord(value, `checks[${String(index)}]`);
    return {
      id: asString(entry['id'], `checks[${String(index)}].id`),
      status: asMember(entry['status'], CHECK_STATUSES, `checks[${String(index)}].status`),
      reason: asString(entry['reason'], `checks[${String(index)}].reason`),
      durationMs: typeof entry['durationMs'] === 'number' ? entry['durationMs'] : 0,
    };
  });

  const acknowledged = asArray(body['acknowledged'], 'acknowledged').map((value, index) => {
    const entry = asRecord(value, `acknowledged[${String(index)}]`);
    return {
      check: asString(entry['check'], `acknowledged[${String(index)}].check`),
      reason: asString(entry['reason'], `acknowledged[${String(index)}].reason`),
      acknowledgedAt: asString(
        entry['acknowledgedAt'],
        `acknowledged[${String(index)}].acknowledgedAt`,
      ),
    };
  });

  const sources = asArray(body['sources'], 'sources').map((value, index) => {
    const entry = asRecord(value, `sources[${String(index)}]`);
    return {
      id: asString(entry['id'], `sources[${String(index)}].id`),
      status: asMember(entry['status'], SOURCE_STATUSES, `sources[${String(index)}].status`),
      reason: asString(entry['reason'], `sources[${String(index)}].reason`),
      count: typeof entry['count'] === 'number' ? entry['count'] : 0,
    };
  });

  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    capturedAt: asString(body['capturedAt'], 'capturedAt'),
    baseSha: asString(body['baseSha'], 'baseSha'),
    fingerprint: asString(body['fingerprint'], 'fingerprint'),
    profile: asMember(body['profile'], PROFILES, 'profile'),
    checks,
    acknowledged,
    findings: asArray(body['findings'], 'findings').map(parseFinding),
    sources,
  };
}
