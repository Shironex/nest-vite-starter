/**
 * The security manifest and the reconciler that checks a run against it, both
 * directions.
 *
 * `apps/api/security-spec/findings.json` records, per audit finding, what every
 * named case is expected to do. A suite that merely passes proves nothing on
 * its own: a case can be deleted, renamed, skipped, quietly turned green, or
 * never run at all, and each of those looks exactly like success from the
 * outside. So the run is compared to the manifest in both directions, and a
 * mismatch either way is a failure.
 *
 * Two distinctions carry the weight:
 *
 * - Only a genuine assertion failure is EVIDENCE. A case that died because
 *   Postgres was unreachable carries the `SPEC-INFRA` marker from
 *   `security-spec/harness.ts` and is reported as `blocked`, never as "the
 *   finding reproduced".
 * - A `control:` case is not an ordinary case. It is the proof that the rest of
 *   the suite is capable of failing, so it must be expected to pass and must
 *   pass; a green suite whose control is red is a suite that is not running.
 *
 * The logic is pure and lives here; `check-security-manifest.ts` is the command
 * that reads the files and prints. That split is what lets the drift cases be
 * unit tested against synthetic JUnit documents instead of by breaking the real
 * suite.
 */
import type { IJUnitCase } from './junit';

export const SPEC_INFRA_MARKER = 'SPEC-INFRA';

/** Where a finding stands. `refuted` = investigated and found not to be real. */
export type FindingStatus = 'proven' | 'fixed' | 'refuted';

/** What a case is expected to do. `fail` is an expected-red case for a `proven` finding. */
export type ExpectedOutcome = 'pass' | 'fail';

export interface IManifestCase {
  /** The full JUnit case name: the describe chain, ' > ', then the case title. */
  readonly name: string;
  readonly expect: ExpectedOutcome;
}

export interface IManifestFinding {
  /** Finding id, e.g. `SEC-001`. */
  readonly id: string;
  /** The issue this finding is tracked as, when there is one. */
  readonly issue?: number;
  readonly title: string;
  readonly status: FindingStatus;
  /** Commits that fixed it, for a `fixed` finding. */
  readonly fixedBy?: readonly string[];
  /** Repo-relative path of the spec, matching the JUnit `file` attribute. */
  readonly spec: string;
  /** Specs elsewhere that cover the wider surface, referenced rather than moved. */
  readonly alsoCoveredBy?: readonly string[];
  readonly cases: readonly IManifestCase[];
}

export interface IManifest {
  readonly version: number;
  readonly findings: readonly IManifestFinding[];
}

export type DriftKind =
  /** A case ran that the manifest does not list. */
  | 'unlisted'
  /** A case the manifest lists did not run. */
  | 'not-run'
  /** The same case ran twice in one file. */
  | 'duplicate-result'
  /** The manifest lists the same case twice. */
  | 'duplicate-entry'
  /** The case ran, and did the opposite of what the manifest records. */
  | 'outcome-drift'
  /** The case was skipped. Never acceptable in this lane. */
  | 'skipped'
  /** The case never reached an assertion (infrastructure, or a suite-level error). */
  | 'blocked'
  /** A `control:` case is not green, so the rest of the file proves nothing. */
  | 'failing-control'
  /** A finding with no `control:` case at all. */
  | 'missing-control'
  /** An expected-red case failed on a thrown error rather than an assertion. */
  | 'not-an-assertion'
  /** The finding's status and its cases' expected outcomes disagree. */
  | 'status-drift';

export interface IDrift {
  readonly kind: DriftKind;
  /** Finding id, when the drift belongs to one. */
  readonly finding?: string;
  readonly spec?: string;
  readonly case?: string;
  readonly message: string;
}

/** The case title alone: everything after the last describe separator. */
export function caseTitle(name: string): string {
  const separator = name.lastIndexOf(' > ');
  return separator === -1 ? name : name.slice(separator + 3);
}

/** A positive control, by the convention the `security-spec-requires-control` rule enforces. */
export function isControl(name: string): boolean {
  return caseTitle(name).trimStart().toLowerCase().startsWith('control:');
}

/**
 * Whether a failure message looks like a jest matcher failure rather than an
 * arbitrary throw. Applied only to a case the manifest expects to FAIL: an
 * expected-red case that dies with a TypeError has not demonstrated the
 * finding, it has crashed on the way there.
 */
const ASSERTION_SIGNATURE = /expect\(|\bExpected:\s|\bReceived:\s|\bExpected\b.*\bReceived\b/su;

/**
 * The first line of a jest failure, which is the sentence a reader needs. The
 * rest is a stack through jest-circus, and a wall of it per drift is how a
 * report stops being read.
 */
function firstLine(messages: readonly string[]): string {
  const message = messages[0];
  if (message === undefined) {
    return 'no message';
  }
  return message.split('\n')[0]?.trim() ?? 'no message';
}

function isInfra(messages: readonly string[]): boolean {
  return messages.some((message) => message.includes(SPEC_INFRA_MARKER));
}

const keyOf = (spec: string, name: string): string => `${spec}\u0000${name}`;

/**
 * Compare a run against the manifest, both directions.
 *
 * Returns every drift found, in manifest order then run order. An empty array
 * means: every recorded case ran exactly once, did exactly what was recorded,
 * every control is green, and nothing ran that is not recorded.
 */
export function reconcile(manifest: IManifest, results: readonly IJUnitCase[]): IDrift[] {
  const drifts: IDrift[] = [];

  const byKey = new Map<string, IJUnitCase[]>();
  for (const result of results) {
    const key = keyOf(result.file, result.name);
    byKey.set(key, [...(byKey.get(key) ?? []), result]);
  }

  const claimed = new Set<string>();

  for (const finding of manifest.findings) {
    const seen = new Set<string>();
    let controls = 0;

    if (finding.status === 'proven' && !finding.cases.some((entry) => entry.expect === 'fail')) {
      drifts.push({
        kind: 'status-drift',
        finding: finding.id,
        spec: finding.spec,
        message: `status is "proven" but no case is expected to fail. A proven finding is one the suite reproduces; record the red case, or move the status to "fixed".`,
      });
    }

    for (const entry of finding.cases) {
      const key = keyOf(finding.spec, entry.name);

      if (seen.has(entry.name)) {
        drifts.push({
          kind: 'duplicate-entry',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message: 'The manifest lists this case twice. One row per case.',
        });
        continue;
      }
      seen.add(entry.name);
      claimed.add(key);

      const control = isControl(entry.name);
      if (control) {
        controls += 1;
      }

      if (control && entry.expect !== 'pass') {
        drifts.push({
          kind: 'failing-control',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message:
            'A control case is recorded as expected to fail. A control exists to show the suite can fail; it is always expected to pass.',
        });
      }

      if (finding.status !== 'proven' && entry.expect === 'fail') {
        drifts.push({
          kind: 'status-drift',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message: `status is "${finding.status}" but this case is expected to fail. Only a "proven" finding carries an expected-red case.`,
        });
      }

      const ran = byKey.get(key) ?? [];

      if (ran.length === 0) {
        drifts.push({
          kind: 'not-run',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message:
            'Recorded in the manifest, but no result carries this name. It was renamed, moved or deleted; a case cannot leave the suite without leaving the manifest.',
        });
        continue;
      }

      if (ran.length > 1) {
        drifts.push({
          kind: 'duplicate-result',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message: `Ran ${String(ran.length)} times in one file. Two cases with the same name cannot be told apart, so neither is evidence.`,
        });
      }

      const result = ran[0] as IJUnitCase;

      if (result.status === 'skipped') {
        drifts.push({
          kind: 'skipped',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message: 'Skipped. A skipped security case is an unproven one, never a passing one.',
        });
        continue;
      }

      if (result.status === 'errored' || isInfra(result.messages)) {
        drifts.push({
          kind: 'blocked',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message: `Blocked before it could assert: ${firstLine(result.messages)}`,
        });
        continue;
      }

      const passed = result.status === 'passed';

      if (control && !passed) {
        drifts.push({
          kind: 'failing-control',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message: `The positive control failed, so nothing else in this file is evidence: ${firstLine(result.messages)}`,
        });
        continue;
      }

      if (passed !== (entry.expect === 'pass')) {
        drifts.push({
          kind: 'outcome-drift',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message: passed
            ? 'Recorded as expected to fail, but it passed. Either the finding is fixed (move it to "fixed" and record the case as passing) or the case stopped reproducing it.'
            : `Recorded as expected to pass, but it failed. Treat this as a regression of the finding, not as a test to adjust: ${firstLine(result.messages)}`,
        });
        continue;
      }

      if (
        !passed &&
        entry.expect === 'fail' &&
        !result.messages.some((message) => ASSERTION_SIGNATURE.test(message))
      ) {
        drifts.push({
          kind: 'not-an-assertion',
          finding: finding.id,
          spec: finding.spec,
          case: entry.name,
          message: `Expected to fail, and it did, but on a thrown error rather than an assertion, so it demonstrates nothing: ${firstLine(result.messages)}`,
        });
      }
    }

    if (controls === 0) {
      drifts.push({
        kind: 'missing-control',
        finding: finding.id,
        spec: finding.spec,
        message:
          'No `control:` case. Without one, every other case here passes just as well when the code under test is never reached.',
      });
    }
  }

  for (const result of results) {
    if (!claimed.has(keyOf(result.file, result.name))) {
      drifts.push({
        kind: 'unlisted',
        spec: result.file,
        case: result.name,
        message:
          'Ran, but no finding lists it. Every case in this lane belongs to a finding; add the row (`pnpm new:finding` writes one) or move the case out of the lane.',
      });
    }
  }

  return drifts;
}

/** Parse and shape-check a manifest document. Throws with the offending path. */
export function parseManifest(source: string): IManifest {
  const raw: unknown = JSON.parse(source);
  const fail = (message: string): never => {
    throw new Error(`findings.json: ${message}`);
  };

  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as IManifest).findings)) {
    return fail('expected an object with a `findings` array');
  }

  const statuses = new Set<string>(['proven', 'fixed', 'refuted']);
  const outcomes = new Set<string>(['pass', 'fail']);
  const seenIds = new Set<string>();

  const findings = (raw as { findings: unknown[] }).findings.map((entry, index) => {
    const at = `findings[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null) {
      return fail(`${at} is not an object`);
    }
    const finding = entry as IManifestFinding;

    if (typeof finding.id !== 'string' || finding.id === '') {
      return fail(`${at}.id must be a non-empty string`);
    }
    if (seenIds.has(finding.id)) {
      return fail(`${at}.id "${finding.id}" is used twice`);
    }
    seenIds.add(finding.id);

    if (finding.issue !== undefined && typeof finding.issue !== 'number') {
      return fail(`${at}.issue, when present, must be an issue number`);
    }
    if (!statuses.has(finding.status)) {
      return fail(`${at}.status must be one of proven, fixed, refuted`);
    }
    if (typeof finding.spec !== 'string' || !finding.spec.endsWith('.security-spec.ts')) {
      return fail(`${at}.spec must be the repo-relative path of a *.security-spec.ts file`);
    }
    if (!Array.isArray(finding.cases) || finding.cases.length === 0) {
      return fail(`${at}.cases must list at least one case`);
    }
    for (const [caseIndex, entryCase] of finding.cases.entries()) {
      const caseAt = `${at}.cases[${String(caseIndex)}]`;
      if (typeof entryCase?.name !== 'string' || entryCase.name === '') {
        return fail(`${caseAt}.name must be the full JUnit case name`);
      }
      if (!outcomes.has(entryCase.expect)) {
        return fail(`${caseAt}.expect must be "pass" or "fail"`);
      }
    }

    return finding;
  });

  return { version: (raw as IManifest).version, findings };
}
