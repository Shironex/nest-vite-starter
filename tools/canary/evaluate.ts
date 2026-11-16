/**
 * The isolation canary's judgment, kept away from the process plumbing that
 * feeds it (`run-isolation-canary.ts` shells out; this decides).
 *
 * A mutant is the production tenant registry minus one model. The lane is
 * expected to go RED in named places: the cases listed for that mutant must
 * fail, every `control:` case must still pass, and a mutant that kills nothing
 * is a surviving mutant, which is a hole in the lane rather than good news.
 */

/** One model's expectation: the cases that must catch its mutant. */
export interface IMutantExpectation {
  /** One line on what the mutant represents, for the report. */
  readonly why: string;
  /**
   * Full case names (jest's `fullName`: the describe chain plus the title) that
   * MUST fail once this model is no longer isolated. A name that no longer
   * exists is reported rather than ignored, so renaming a case away from its
   * canary entry is caught.
   */
  readonly mustFail: readonly string[];
}

export interface ICanaryManifest {
  /** Case titles starting with this prefix must pass against EVERY mutant. */
  readonly controlPrefix: string;
  /** Model accessor (or the pass-through-all key) to its expectation. */
  readonly mutants: Readonly<Record<string, IMutantExpectation>>;
}

/** One case from a jest `--json` report, reduced to what the judgment reads. */
export interface ICaseResult {
  readonly fullName: string;
  readonly title: string;
  readonly status: string;
}

export interface IMutantVerdict {
  readonly mutant: string;
  /** Named cases that failed, as required. */
  readonly killedBy: readonly string[];
  /** Named cases that stayed green: the mutant survived them. */
  readonly survivors: readonly string[];
  /** Named cases that did not run: renamed, deleted or skipped. */
  readonly missing: readonly string[];
  /** `control:` cases that broke, which means the mutant proved nothing. */
  readonly brokenControls: readonly string[];
  readonly ok: boolean;
}

interface IJestAssertion {
  readonly fullName?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
}

interface IJestSuite {
  readonly assertionResults?: unknown;
}

/**
 * The cases in a jest `--json` report. Throws on a shape it does not recognize:
 * an unreadable report must never read as "no failures".
 */
export function parseJestCases(report: unknown): ICaseResult[] {
  const suites = (report as { testResults?: unknown })?.testResults;
  if (!Array.isArray(suites)) {
    throw new Error('Jest report has no `testResults` array; the run probably never started.');
  }

  const cases: ICaseResult[] = [];
  for (const suite of suites as IJestSuite[]) {
    const assertions = suite.assertionResults;
    if (!Array.isArray(assertions)) {
      throw new Error('Jest report has a suite with no `assertionResults` array.');
    }
    for (const assertion of assertions as IJestAssertion[]) {
      const { fullName, title, status } = assertion;
      if (typeof fullName !== 'string' || typeof title !== 'string' || typeof status !== 'string') {
        throw new Error('Jest report has an assertion with no fullName/title/status.');
      }
      cases.push({ fullName, title, status });
    }
  }
  return cases;
}

/** Every case in the report that is a control (by title prefix). */
function controls(cases: readonly ICaseResult[], controlPrefix: string): ICaseResult[] {
  return cases.filter((one) => one.title.startsWith(controlPrefix));
}

/**
 * The baseline run: no mutant, so the whole lane must be green. It is what
 * proves the canary seam itself changed nothing.
 */
export function judgeBaseline(cases: readonly ICaseResult[]): {
  failures: readonly string[];
  ok: boolean;
} {
  const failures = cases.filter((one) => one.status !== 'passed').map((one) => one.fullName);
  return { failures, ok: failures.length === 0 && cases.length > 0 };
}

export function judgeMutant(
  mutant: string,
  expectation: IMutantExpectation,
  cases: readonly ICaseResult[],
  controlPrefix: string,
): IMutantVerdict {
  const byName = new Map(cases.map((one) => [one.fullName, one]));

  const killedBy: string[] = [];
  const survivors: string[] = [];
  const missing: string[] = [];

  for (const name of expectation.mustFail) {
    const result = byName.get(name);
    if (result === undefined || result.status === 'pending') {
      // A skipped case caught nothing, so it counts as absent rather than as a
      // kill: `it.skip` on a named case must not read as a dead mutant.
      missing.push(name);
    } else if (result.status === 'passed') {
      survivors.push(name);
    } else {
      killedBy.push(name);
    }
  }

  const brokenControls = controls(cases, controlPrefix)
    .filter((one) => one.status !== 'passed')
    .map((one) => one.fullName);

  return {
    mutant,
    killedBy,
    survivors,
    missing,
    brokenControls,
    ok:
      killedBy.length > 0 &&
      survivors.length === 0 &&
      missing.length === 0 &&
      brokenControls.length === 0,
  };
}

/** Human-readable lines for one verdict, most important first. */
export function formatVerdict(verdict: IMutantVerdict): string[] {
  if (verdict.ok) {
    return [`PASS  ${verdict.mutant}: killed by ${String(verdict.killedBy.length)} named case(s)`];
  }

  const lines = [`FAIL  ${verdict.mutant}`];
  for (const name of verdict.survivors) {
    lines.push(`        survived: ${name}`);
  }
  for (const name of verdict.missing) {
    lines.push(`        did not run (renamed, removed or skipped?): ${name}`);
  }
  for (const name of verdict.brokenControls) {
    lines.push(`        control broke, so the mutant proved nothing: ${name}`);
  }
  if (verdict.killedBy.length === 0 && verdict.survivors.length === 0) {
    lines.push('        the manifest names no case for this mutant, so nothing can catch it');
  }
  return lines;
}
