import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ICheckSpec, IReportSpec } from './checks';
import { checksFor } from './checks';
import type { ISandboxDescriptor } from './descriptor';
import { laneDatabaseUrl, laneRedisUrl } from './descriptor';
import { dockerAvailable } from './docker';
import { runE2eLane } from './e2e-runtime';
import { run } from './exec';
import { treeFingerprint } from './fingerprint';
import { laneById } from './lanes';
import { hostPortOf, tcpReachable } from './net-probe';
import { verificationDir } from './ownership';
import type { IVerdict } from './reports';
import { classify, parseJestJson, parseJunit } from './reports';
import type { ICheckResult, IEvidence, Profile } from './result';
import { buildEvidence } from './result';
import { current, down, up } from './sandbox-lifecycle';

/*
 * The orchestrator. It owns three things nothing else does: the tree
 * fingerprint taken on both sides of the run, the decision to bring a sandbox
 * up for the lanes that need one (and to take down only a sandbox it started),
 * and the mapping from "a command exited N" to a status. Everything it runs is
 * an existing repo script; it schedules nothing, because turbo already does.
 */
export interface IRunnerOptions {
  readonly root: string;
  readonly profile: Profile;
  readonly log: (message: string) => void;
  /**
   * Keep this process's stdout free of child output, so `--json` can put the
   * evidence document there alone. Every check's own output goes to stderr.
   */
  readonly quietStdout?: boolean;
}

function needsSandbox(checks: readonly ICheckSpec[]): boolean {
  return checks.some((check) => check.lane !== undefined || check.e2eLane === true);
}

function laneEnv(descriptor: ISandboxDescriptor, check: ICheckSpec): Record<string, string> {
  if (check.lane === undefined) {
    return {};
  }
  const lane = laneById(check.lane);
  return {
    DATABASE_URL: laneDatabaseUrl(descriptor, lane),
    REDIS_URL: laneRedisUrl(descriptor, lane),
  };
}

function readReport(root: string, spec: IReportSpec, exitCode: number): IVerdict {
  const file = join(root, spec.file);
  if (!existsSync(file)) {
    return { status: 'blocked', reason: 'report_missing' };
  }
  const text = readFileSync(file, 'utf8');
  return classify(spec.kind === 'junit' ? parseJunit(text) : parseJestJson(text), exitCode);
}

async function laneReachable(env: Readonly<Record<string, string>>): Promise<boolean> {
  const target = hostPortOf(env['DATABASE_URL'] ?? '');
  return target === null ? false : tcpReachable(target.host, target.port);
}

async function runCheck(
  options: IRunnerOptions,
  check: ICheckSpec,
  descriptor: ISandboxDescriptor | null,
): Promise<ICheckResult> {
  const startedAt = Date.now();
  const blocked = (reason: string): ICheckResult => ({
    id: check.id,
    status: 'blocked',
    reason,
    durationMs: Date.now() - startedAt,
    command: check.command,
  });

  if ((check.lane !== undefined || check.e2eLane === true) && descriptor === null) {
    return blocked('sandbox_unavailable');
  }

  if (check.report !== undefined) {
    const reportFile = join(options.root, check.report.file);
    mkdirSync(dirname(reportFile), { recursive: true, mode: 0o700 });
    rmSync(reportFile, { force: true });
  }

  if (check.e2eLane === true) {
    if (descriptor === null || check.report === undefined) {
      return blocked('sandbox_unavailable');
    }
    const lane = await runE2eLane({
      root: options.root,
      descriptor,
      log: options.log,
      quietStdout: options.quietStdout === true,
    });
    const verdict = readReport(options.root, check.report, lane.status);
    return {
      id: check.id,
      ...verdict,
      durationMs: Date.now() - startedAt,
      command: check.command,
    };
  }

  const env = descriptor === null ? {} : laneEnv(descriptor, check);
  // A lane check is only evidence while its database is there. Probed on both
  // sides of the run, so a service stopped mid-run reports blocked rather than
  // a failure of the code it never reached.
  if (check.lane !== undefined && !(await laneReachable(env))) {
    return blocked('service_unavailable');
  }

  const reportArgs = (check.report?.args ?? []).map((arg) =>
    check.report === undefined
      ? arg
      : arg.replace('{{reportPath}}', join(options.root, check.report.file)),
  );
  const result = run(check.command[0] ?? '', [...check.command.slice(1), ...reportArgs], {
    cwd: options.root,
    env,
    inherit: true,
    inheritEnv: true,
    stdoutToStderr: options.quietStdout === true,
  });

  if (result.status === 127) {
    return blocked(`command_unavailable (${check.command.join(' ')})`);
  }
  if (check.lane !== undefined && result.status !== 0 && !(await laneReachable(env))) {
    return blocked('service_unavailable');
  }

  if (check.report !== undefined) {
    const verdict = readReport(options.root, check.report, result.status);
    return {
      id: check.id,
      ...verdict,
      durationMs: Date.now() - startedAt,
      command: check.command,
    };
  }

  // A check that declares a "could not check" exit code gets `blocked` for it,
  // so "no evidence" keeps traveling as blocked rather than being flattened
  // into a failure that looks like the code is wrong.
  if (check.blockedExitCode !== undefined && result.status === check.blockedExitCode) {
    return blocked(`exit ${result.status}`);
  }

  return {
    id: check.id,
    status: result.status === 0 ? 'passed' : 'failed',
    reason: result.status === 0 ? 'exit 0' : `exit ${result.status}`,
    durationMs: Date.now() - startedAt,
    command: check.command,
  };
}

export interface IRunnerOutcome {
  readonly evidence: IEvidence;
  readonly file: string;
}

export async function runProfile(options: IRunnerOptions): Promise<IRunnerOutcome> {
  const { root, profile } = options;
  const checks = checksFor(profile);
  const startedAt = new Date();
  const before = treeFingerprint(root);
  const runId = `${startedAt.toISOString().replace(/[:.]/gu, '-')}-${profile}`;

  let descriptor = needsSandbox(checks) ? current(root) : null;
  let startedSandbox = false;
  if (needsSandbox(checks) && descriptor === null && dockerAvailable()) {
    options.log('Starting a sandbox for the lane checks');
    descriptor = (await up(root)).descriptor;
    startedSandbox = true;
  }

  const results: ICheckResult[] = [];
  try {
    for (const check of checks) {
      options.log(`▶ ${check.id}`);
      results.push(await runCheck(options, check, descriptor));
    }
  } finally {
    if (startedSandbox) {
      down(root);
    }
  }

  const after = treeFingerprint(root);
  const finishedAt = new Date();
  const evidence = buildEvidence({
    profile,
    runId,
    commit: before.commit,
    fingerprint: before.fingerprint,
    treeStable: before.fingerprint === after.fingerprint && before.commit === after.commit,
    startedAt,
    finishedAt,
    checks: results,
  });

  const dir = verificationDir(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${runId}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });

  return { evidence, file };
}
