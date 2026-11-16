/*
 * The evidence `pnpm verify` writes, and the only place an exit code is
 * decided. Four statuses, and the one that matters is `blocked`: it is what a
 * check that did not run reports, and it dominates the exit code, so "we could
 * not check" can never be read as "it passed".
 */
export type CheckStatus = 'passed' | 'failed' | 'blocked' | 'not_applicable';

export type Profile = 'static' | 'feature' | 'release';

export const EVIDENCE_SCHEMA_VERSION = 1;

export interface ICheckResult {
  readonly id: string;
  readonly status: CheckStatus;
  readonly reason: string;
  readonly durationMs: number;
  /**
   * The argv this check ran, so the evidence says what to re-run.
   *
   * A check streams its own output live and none of it is kept here, which is
   * right: 25 checks of turbo and vitest progress do not belong in a JSON
   * document. But it left the evidence saying `failed, exit 2` and nothing
   * else, and reading that afterwards there is no way to tell which command
   * produced it. Recording the argv costs a line and turns a dead record into
   * one you can act on.
   */
  readonly command?: readonly string[];
}

export interface IExecution {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  /** False when the tree changed between the opening and closing fingerprint. */
  readonly treeStable: boolean;
  readonly status: Exclude<CheckStatus, 'not_applicable'>;
  readonly exitCode: number;
}

export interface IEvidence {
  readonly schemaVersion: number;
  readonly profile: Profile;
  readonly commit: string;
  readonly fingerprint: string;
  readonly checks: readonly ICheckResult[];
  readonly execution: IExecution;
}

export function overallStatus(
  checks: readonly ICheckResult[],
  treeStable: boolean,
): Exclude<CheckStatus, 'not_applicable'> {
  if (!treeStable || checks.some((check) => check.status === 'blocked')) {
    return 'blocked';
  }
  if (checks.some((check) => check.status === 'failed')) {
    return 'failed';
  }
  return 'passed';
}

export function exitCodeFor(status: Exclude<CheckStatus, 'not_applicable'>): number {
  switch (status) {
    case 'passed':
      return 0;
    case 'failed':
      return 1;
    case 'blocked':
      return 2;
  }
}

export interface IEvidenceInput {
  readonly profile: Profile;
  readonly runId: string;
  readonly commit: string;
  readonly fingerprint: string;
  readonly treeStable: boolean;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly checks: readonly ICheckResult[];
}

export function buildEvidence(input: IEvidenceInput): IEvidence {
  const status = overallStatus(input.checks, input.treeStable);
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    profile: input.profile,
    commit: input.commit,
    fingerprint: input.fingerprint,
    checks: input.checks,
    execution: {
      runId: input.runId,
      startedAt: input.startedAt.toISOString(),
      finishedAt: input.finishedAt.toISOString(),
      durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
      treeStable: input.treeStable,
      status,
      exitCode: exitCodeFor(status),
    },
  };
}

/**
 * The argv to re-run for every check that did not pass.
 *
 * Each check streams its own output while it runs, so after a full profile the
 * failure is thousands of lines above the summary and the evidence file records
 * only `exit 2`. This puts the next command on the last screen, and it is what
 * makes `command` on a result worth recording.
 */
export function reproduceLines(checks: readonly ICheckResult[]): readonly string[] {
  const unresolved = checks.filter(
    (check) => check.status === 'failed' || check.status === 'blocked',
  );
  if (unresolved.length === 0) return [];

  return [
    '  re-run just what did not pass:',
    ...unresolved.map((check) => {
      const argv = (check.command ?? []).join(' ');
      return `    ${check.id.padEnd(22)} ${argv === '' ? '(no command recorded)' : argv}`;
    }),
  ];
}
