import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { parseJUnit } from '../quality/junit';
import { assertKnownFlags, boolFlag, parseArgs, stringFlag } from './args';
import { stopWritingOnClosedPipe } from './cli-io';
import { run } from './exec';
import type { IFinding, IInventory } from './inventory';
import {
  acceptInto,
  auditMerge,
  diffInventory,
  emptyInventory,
  formatFindings,
  observe,
  parseInventory,
  serializeInventory,
  tally,
  totalCases,
} from './inventory';
import type { IInventorySuite } from './inventory-suites';
import { INVENTORY_SUITES, suiteById } from './inventory-suites';

/*
 * `pnpm verify:inventory`: compare a test run against the committed baselines
 * in tools/verify/inventories/.
 *
 * This file only does I/O: spawn a suite, read its JUnit, read a baseline, ask
 * inventory.ts what it means, print, exit. The judgment is all in inventory.ts,
 * where it is unit tested without a test run.
 *
 * Exit codes match `pnpm verify`: 0 agreed, 1 disagreed, 2 could not check.
 */
const USAGE = `Usage: pnpm verify:inventory [--suite=<id>[,<id>]] [--from-report]
                            [--accept [--allow-removals]]
       pnpm verify:inventory --merge-audit[=<commit>]

  --suite=<id>      Only these suites. Default: all of them.
                    ${INVENTORY_SUITES.map((suite) => suite.id).join(', ')}
  --from-report     Do not run anything; read the JUnit each runner already
                    wrote. This is the form CI uses, inside the job that just
                    ran the suite, and the form the \`inventory\` verify check uses.
  --accept          Write additions into the baselines.
  --allow-removals  Write removals too. Separate on purpose: "this test is gone"
                    is the claim this whole mechanism exists to make someone say.
  --merge-audit     Audit a merge commit instead: report every inventory entry
                    whose value at the merge neither parent's diff explains.
                    That is merge damage.

A skipped case is reported whatever the baseline says and --accept never writes
one: a tracked \`.skip\` lints clean, and a case that does not run is not a case.`;

const BASELINE_DIR = 'tools/verify/inventories';

function baselinePath(root: string, suite: IInventorySuite): string {
  return join(root, BASELINE_DIR, `${suite.id}.json`);
}

function readBaseline(root: string, suite: IInventorySuite): IInventory | null {
  const file = baselinePath(root, suite);
  return existsSync(file) ? parseInventory(readFileSync(file, 'utf8'), suite.id) : null;
}

function writeBaseline(root: string, inventory: IInventory): string {
  const file = join(root, BASELINE_DIR, `${inventory.suite}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeInventory(inventory), 'utf8');
  return file;
}

/*
 * A lane suite reads DATABASE_URL / REDIS_URL from the environment, and
 * `exec.run` deliberately strips both so a verify check cannot inherit the
 * developer's dev stack. Here the exported value IS the instruction (AGENTS.md
 * tells you to export a sandbox lane url before running the lane by hand), so
 * pass it back in explicitly rather than silently dropping it.
 */
function serviceEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['DATABASE_URL', 'REDIS_URL']) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      env[key] = value;
    }
  }
  return env;
}

interface ISuiteOutcome {
  readonly suite: IInventorySuite;
  readonly line: string;
  readonly findings: readonly IFinding[];
  /** True when nothing could be judged: no report, no baseline, a bad parse. */
  readonly blocked: boolean;
  readonly observed: IInventory | null;
}

function judge(
  root: string,
  suite: IInventorySuite,
  log: (message: string) => void,
): ISuiteOutcome {
  const reportFile = join(root, suite.report);
  const blocked = (line: string): ISuiteOutcome => ({
    suite,
    line,
    findings: [],
    blocked: true,
    observed: null,
  });

  if (!existsSync(reportFile)) {
    return blocked(
      `${suite.id} (${suite.label}): no report at ${suite.report}. The suite did not run, which is never a pass.`,
    );
  }

  const cases = parseJUnit(readFileSync(reportFile, 'utf8'));
  if (cases.length === 0) {
    return blocked(`${suite.id}: ${suite.report} holds no test case.`);
  }

  const seen = observe(cases, { pathBase: suite.pathBase, root });
  const observed = tally(suite.id, seen);
  const baseline = readBaseline(root, suite);
  if (baseline === null) {
    log(
      `${suite.id}: no baseline yet; run \`pnpm verify:inventory --accept --suite=${suite.id}\`.`,
    );
    return { suite, line: `${suite.id}: no baseline`, findings: [], blocked: true, observed };
  }

  const findings = diffInventory(
    baseline,
    observed,
    seen.filter((observedCase) => observedCase.skipped),
  );
  const summary = `${String(totalCases(observed))} case(s), baseline ${String(totalCases(baseline))}`;
  return {
    suite,
    line:
      findings.length === 0
        ? `${suite.id}: agrees (${summary})`
        : `${suite.id}: ${String(findings.length)} disagreement(s) (${summary})`,
    findings,
    blocked: false,
    observed,
  };
}

function runSuite(root: string, suite: IInventorySuite, log: (message: string) => void): void {
  log(`▶ ${suite.id}: ${suite.command.join(' ')}`);
  rmSync(join(root, suite.report), { force: true });
  // The exit code is not read on purpose: a red suite still has an inventory,
  // and a case that disappeared is exactly as interesting when its neighbors
  // failed. `verify`'s own unit / isolation / e2e checks judge the run.
  run(suite.command[0] ?? '', suite.command.slice(1), {
    cwd: root,
    inherit: true,
    inheritEnv: true,
    env: suite.lane === undefined ? {} : serviceEnv(),
  });
}

function selectedSuites(value: string | null): readonly IInventorySuite[] {
  if (value === null) {
    return INVENTORY_SUITES;
  }
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
    .map(suiteById);
}

/* The merge audit reads baselines out of git rather than off disk. */
function gitShow(root: string, rev: string, path: string): string | null {
  const result = run('git', ['show', `${rev}:${path}`], { cwd: root });
  return result.status === 0 ? result.stdout : null;
}

function inventoryAt(root: string, rev: string, suite: IInventorySuite): IInventory {
  const text = gitShow(root, rev, `${BASELINE_DIR}/${suite.id}.json`);
  return text === null ? emptyInventory(suite.id) : parseInventory(text, suite.id);
}

function mergeAudit(root: string, commit: string, log: (message: string) => void): number {
  const parents = run('git', ['rev-parse', `${commit}^@`], { cwd: root });
  const parentShas = parents.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (parents.status !== 0) {
    log(`Cannot resolve ${commit}.`);
    return 2;
  }
  if (parentShas.length < 2) {
    log(
      `${commit} is not a merge commit (${String(parentShas.length)} parent(s)); nothing to audit.`,
    );
    return 2;
  }

  const [left, right] = parentShas;
  const base = run('git', ['merge-base', left ?? '', right ?? ''], { cwd: root });
  if (base.status !== 0) {
    log(`No merge base between ${String(left)} and ${String(right)}.`);
    return 2;
  }
  const baseSha = base.stdout.trim();

  const findings: IFinding[] = [];
  for (const suite of INVENTORY_SUITES) {
    findings.push(
      ...auditMerge(suite.id, {
        base: inventoryAt(root, baseSha, suite),
        left: inventoryAt(root, left ?? '', suite),
        right: inventoryAt(root, right ?? '', suite),
        merged: inventoryAt(root, commit, suite),
      }),
    );
  }

  log(
    `merge audit of ${commit}: parents ${String(left).slice(0, 8)} and ${String(right).slice(0, 8)}, base ${baseSha.slice(0, 8)}`,
  );
  if (findings.length === 0) {
    log('  every inventory entry is explained by one of the parents.');
    return 0;
  }
  log(
    `  ${String(findings.length)} entr(ies) neither parent explains:\n${formatFindings(findings)}`,
  );
  log(
    '\nThat is merge damage: the merged tree carries a case list neither branch wrote. Re-resolve the merge, do not re-accept the baseline.',
  );
  return 1;
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  assertKnownFlags(
    parsed,
    ['suite', 'from-report', 'accept', 'allow-removals', 'merge-audit', 'help'],
    USAGE,
  );
  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  if (boolFlag(parsed, 'help')) {
    log(USAGE);
    return 0;
  }

  const root = resolve(process.cwd());

  const mergeFlag = parsed.flags['merge-audit'];
  if (mergeFlag !== undefined) {
    return mergeAudit(root, mergeFlag === true ? 'HEAD' : mergeFlag, log);
  }

  const suites = selectedSuites(stringFlag(parsed, 'suite'));
  const accept = boolFlag(parsed, 'accept');
  const allowRemovals = boolFlag(parsed, 'allow-removals');

  if (!boolFlag(parsed, 'from-report')) {
    const named = stringFlag(parsed, 'suite') !== null;
    for (const suite of suites) {
      if (suite.onDemand === true && !named) {
        log(`${suite.id}: on demand; name it with --suite=${suite.id} to run it.`);
        continue;
      }
      runSuite(root, suite, log);
    }
  }

  const outcomes = suites.map((suite) => judge(root, suite, log));
  const findings = outcomes.flatMap((outcome) => outcome.findings);
  const blocking = outcomes.filter(
    (outcome) => outcome.blocked && (outcome.suite.required || outcome.observed !== null),
  );

  if (accept) {
    const refused: IFinding[] = [];
    for (const outcome of outcomes) {
      if (outcome.observed === null) {
        // Say so. A suite that left nothing to read is not a suite that was
        // accepted, and silence here would read as success.
        log(`  ${outcome.line}`);
        continue;
      }
      const baseline = readBaseline(root, outcome.suite) ?? emptyInventory(outcome.suite.id);
      const acceptance = acceptInto(baseline, outcome.observed, allowRemovals);
      refused.push(...acceptance.refused);
      const file = writeBaseline(root, acceptance.next);
      log(
        `accepted ${outcome.suite.id}: ${String(totalCases(acceptance.next))} case(s) -> ${file}`,
      );
    }
    const skipped = findings.filter((finding) => finding.kind === 'skipped');
    if (refused.length > 0) {
      log(`\nNot written (they remove cases):\n${formatFindings(refused)}`);
    }
    if (skipped.length > 0) {
      log(
        `\nStill reported, and never acceptable:\n${formatFindings(skipped)}\n\nUn-skip them or delete them; a tracked skip is not a test.`,
      );
    }
    if (refused.length + skipped.length > 0) {
      return 1;
    }
    return blocking.length > 0 ? 2 : 0;
  }

  for (const outcome of outcomes) {
    log(`  ${outcome.line}`);
  }

  if (findings.length > 0) {
    log(
      `\ntest inventory DISAGREES: ${String(findings.length)} finding(s).\n${formatFindings(findings)}`,
    );
    log(
      '\nA green suite that lost a case is not a green suite. Restore it, or accept the change on purpose:\n  pnpm verify:inventory --accept [--allow-removals]',
    );
  }
  if (blocking.length > 0) {
    log(
      `\ntest inventory COULD NOT CHECK ${String(blocking.length)} suite(s):\n${blocking.map((outcome) => `  ${outcome.line}`).join('\n')}`,
    );
    return 2;
  }
  if (findings.length > 0) {
    return 1;
  }

  const judged = outcomes.filter((outcome) => !outcome.blocked).length;
  log(`test inventory OK: ${String(judged)} suite(s) match their baseline.`);
  return 0;
}

stopWritingOnClosedPipe();

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
