/**
 * `pnpm check:security`: run the security lane and reconcile it against
 * `apps/api/security-spec/findings.json`.
 *
 * This command, not jest's exit code, is the gate. A finding recorded as
 * `proven` carries an expected-red case, so a red jest run can be exactly
 * right; and a green jest run proves nothing if a case was renamed out of
 * existence, skipped, or never ran because Postgres was down. The reconciler in
 * `security-manifest.ts` answers both questions and this file only does I/O:
 * spawn, read, print, exit.
 *
 *   pnpm check:security                  # run the suite, then reconcile
 *   pnpm check:security -- --junit <p>   # reconcile a report produced elsewhere
 *
 * In CI the second form is the useful one: the suite already ran as a step in
 * test-api, and this reads the report it left behind.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJUnit } from './junit';
import { parseManifest, reconcile, type IDrift } from './security-manifest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_MANIFEST = join(REPO_ROOT, 'apps/api/security-spec/findings.json');
const DEFAULT_JUNIT = join(REPO_ROOT, 'apps/api/security-spec/.junit/security.xml');

interface IOptions {
  readonly manifestPath: string;
  readonly junitPath: string;
  /** Whether to run the suite first. False when the caller supplied a report. */
  readonly run: boolean;
}

function parseArgs(argv: readonly string[]): IOptions {
  let manifestPath = DEFAULT_MANIFEST;
  let junitPath = DEFAULT_JUNIT;
  let run = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === '--manifest' && value !== undefined) {
      manifestPath = resolve(value);
      index += 1;
    } else if (arg === '--junit' && value !== undefined) {
      junitPath = resolve(value);
      run = false;
      index += 1;
    } else if (arg === '--no-run') {
      run = false;
    } else {
      throw new Error(`Unknown argument "${String(arg)}"`);
    }
  }

  return { manifestPath, junitPath, run };
}

/**
 * Run the lane. Its exit code is deliberately ignored: an expected-red case
 * makes jest exit non-zero and that is a correct outcome here. What matters is
 * that a report was produced, which the caller checks next.
 */
function runSuite(): void {
  // No `env` option: the child inherits this process's environment, which is
  // how an exported DATABASE_URL reaches the suite. Passing it explicitly would
  // be the same value read the long way round.
  spawnSync('pnpm', ['--filter', '@repo/api', 'test:security'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

function describe(drift: IDrift): string {
  const where = [drift.finding, drift.spec, drift.case].filter(Boolean).join(' :: ');
  return `  [${drift.kind}] ${where}\n      ${drift.message}`;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (!existsSync(options.manifestPath)) {
    console.error(`No manifest at ${options.manifestPath}`);
    process.exit(1);
  }
  const manifest = parseManifest(readFileSync(options.manifestPath, 'utf8'));

  if (options.run) {
    runSuite();
  }

  if (!existsSync(options.junitPath)) {
    console.error(
      `No JUnit report at ${options.junitPath}. The suite did not run, or it could not start at all, which is never a pass.`,
    );
    process.exit(1);
  }

  const results = parseJUnit(readFileSync(options.junitPath, 'utf8'));
  const drifts = reconcile(manifest, results);

  const caseCount = manifest.findings.reduce((total, finding) => total + finding.cases.length, 0);

  if (drifts.length === 0) {
    console.log(
      `security manifest OK: ${String(manifest.findings.length)} findings, ${String(caseCount)} cases, ${String(results.length)} results, every outcome as recorded.`,
    );
    return;
  }

  console.error(
    `security manifest FAILED: ${String(drifts.length)} drift(s) between ${options.junitPath} and the manifest.\n`,
  );
  for (const drift of drifts) {
    console.error(describe(drift));
  }
  console.error(
    '\nA drift is a claim that changed. Fix the code, or record the new truth in findings.json deliberately; never both at once.',
  );
  process.exit(1);
}

main();
