/*
 * A test runner's exit code alone is not evidence. A suite that ran nothing, a
 * report that did not parse, a spec skipped into silence and an exit code that
 * disagrees with its own totals all exit 0, and all of them mean "we do not
 * know", which is `blocked`, never `passed`.
 *
 * Two report shapes are read: the JUnit XML Playwright and vitest can emit, and
 * the JSON jest writes with --json. Both are built in, so no reporter package
 * is required to get a trustworthy verdict out of a lane.
 */
import type { CheckStatus } from './result';

export interface ITestTotals {
  readonly tests: number;
  readonly failures: number;
  readonly skipped: number;
}

export interface IVerdict {
  readonly status: CheckStatus;
  readonly reason: string;
}

function attribute(tag: string, name: string): number {
  const match = new RegExp(`\\b${name}="(\\d+)"`, 'u').exec(tag);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

export function parseJunit(xml: string): ITestTotals | null {
  const root = /<testsuites\b[^>]*>/u.exec(xml);
  if (root?.[0] !== undefined) {
    return {
      tests: attribute(root[0], 'tests'),
      failures: attribute(root[0], 'failures') + attribute(root[0], 'errors'),
      skipped: attribute(root[0], 'skipped'),
    };
  }

  const suites = [...xml.matchAll(/<testsuite\b[^>]*>/gu)].map((match) => match[0]);
  if (suites.length === 0) {
    return null;
  }
  return suites.reduce<ITestTotals>(
    (totals, tag) => ({
      tests: totals.tests + attribute(tag, 'tests'),
      failures: totals.failures + attribute(tag, 'failures') + attribute(tag, 'errors'),
      skipped: totals.skipped + attribute(tag, 'skipped'),
    }),
    { tests: 0, failures: 0, skipped: 0 },
  );
}

export function parseJestJson(json: string): ITestTotals | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const report = parsed as Record<string, unknown>;
  const numbers = ['numTotalTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
  if (!numbers.every((key) => typeof report[key] === 'number')) {
    return null;
  }

  return {
    tests: report['numTotalTests'] as number,
    failures: report['numFailedTests'] as number,
    skipped: (report['numPendingTests'] as number) + (report['numTodoTests'] as number),
  };
}

/** Turn totals plus the runner's exit code into a status, failing closed. */
export function classify(totals: ITestTotals | null, exitCode: number): IVerdict {
  if (totals === null) {
    return { status: 'blocked', reason: 'report_malformed' };
  }
  if (totals.tests === 0) {
    return { status: 'blocked', reason: 'report_empty' };
  }

  const reportsFailure = totals.failures > 0;
  if (reportsFailure !== (exitCode !== 0)) {
    return {
      status: 'blocked',
      reason: `exit_code_disagrees (exit ${exitCode}, ${totals.failures} failure(s))`,
    };
  }
  if (reportsFailure) {
    return { status: 'failed', reason: `${totals.failures} of ${totals.tests} test(s) failed` };
  }
  if (totals.skipped > 0) {
    return { status: 'blocked', reason: `skipped_cases (${totals.skipped} of ${totals.tests})` };
  }

  return { status: 'passed', reason: `${totals.tests} test(s) passed` };
}
