import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { assertKnownFlags, boolFlag, parseArgs, stringFlag } from './args';
import type { IBaseline, ICollection, IGrade } from './baseline';
import {
  ABSOLUTE_GATE_NOTICE,
  acknowledgeInto,
  buildBaseline,
  formatDiff,
  formatReview,
  gradeAgainstBaseline,
  gradeExitCode,
  parseBaseline,
  reviewBaseline,
  serializeBaseline,
  totalFindings,
} from './baseline';
import { collect } from './baseline-sources';
import { stopWritingOnClosedPipe } from './cli-io';
import { baselinesDir } from './ownership';
import type { IEvidence, Profile } from './result';
import { runProfile } from './runner';

/*
 * `pnpm verify:baseline`: capture the gate once on a base commit, then grade
 * a branch on what it ADDED.
 *
 * Only I/O lives here: run the profile, read and write the baseline file,
 * print, exit. Every judgment is in baseline.ts, unit tested without running a
 * check, because any orchestrating tool can import that module directly.
 *
 * Exit codes match `pnpm verify`: 0 passed, 1 failed, 2 could not check.
 */
const USAGE = `Usage: pnpm verify:baseline capture [--profile=feature] [--from-evidence=<file>] [--json]
       pnpm verify:baseline compare [--baseline=<sha|file>] [--json]
       pnpm verify:baseline acknowledge --check=<id> --reason="<why>" [--baseline=<sha|file>]
       pnpm verify:baseline show [--baseline=<sha|file>] [--json]

  capture      Run \`pnpm verify\` on this tree, read the violations each check
               named, and write .agent-state/baselines/<baseSha>.json. Run it on
               the branch's BASE commit, once. Exits 1 when the base is red: the
               work does not start until the base is fixed or each red check is
               acknowledged by name.
  compare      Grade this working tree against a captured baseline. Passes only
               when it adds no new key and raises no count; the keys it did add
               are printed, so nobody has to re-run anything to find out why.
               Run \`pnpm verify --profile=feature\` on the branch first: the
               test keys are read from the JUnit that run writes, so comparing
               without one grades this tree's lint and types against the base
               but an OLDER tree's tests.
  acknowledge  Record a decision to carry one red check, with a reason. The
               reason is stored in the baseline, because the point is that "we
               knew about that one" is a claim somebody made, not a subtraction.
  show         Print a captured baseline's review and its key counts.

${ABSOLUTE_GATE_NOTICE}

Exit codes: 0 passed, 1 failed (red base, or new violations), 2 blocked (a
source that could not be collected, so nothing can be subtracted for it).`;

const PROFILES: readonly Profile[] = ['static', 'feature', 'release'];

function parseProfile(value: string | null): Profile {
  if (value === null) {
    return 'feature';
  }
  const profile = PROFILES.find((candidate) => candidate === value);
  if (profile === undefined) {
    throw new Error(`Unknown profile "${value}". Choose one of: ${PROFILES.join(', ')}.`);
  }
  return profile;
}

function baselineFile(root: string, baseSha: string): string {
  return join(baselinesDir(root), `${baseSha}.json`);
}

/**
 * Where to read a baseline from.
 *
 * `--baseline` takes a sha or a path. With neither, the only captured baseline
 * is used, and having more than one is an error rather than a guess: grading a
 * branch against the wrong base is exactly the confusion this tool exists to
 * end.
 */
function resolveBaselineFile(root: string, flag: string | null): string {
  if (flag !== null) {
    const asPath = resolve(root, flag);
    if (existsSync(asPath)) {
      return asPath;
    }
    const asSha = baselineFile(root, flag);
    if (existsSync(asSha)) {
      return asSha;
    }
    throw new Error(`No baseline at ${flag}. Capture one with \`pnpm verify:baseline capture\`.`);
  }

  const dir = baselinesDir(root);
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
  if (files.length === 0) {
    throw new Error(
      "No baseline captured yet. Run `pnpm verify:baseline capture` on the branch's base commit.",
    );
  }
  if (files.length > 1) {
    throw new Error(
      `${String(files.length)} baselines are captured; name one with --baseline=<sha>: ${files
        .map((name) => name.replace(/\.json$/u, ''))
        .join(', ')}`,
    );
  }
  return join(dir, files[0] ?? '');
}

function readBaseline(root: string, flag: string | null): { baseline: IBaseline; file: string } {
  const file = resolveBaselineFile(root, flag);
  return { baseline: parseBaseline(readFileSync(file, 'utf8')), file };
}

function writeBaseline(root: string, baseline: IBaseline): string {
  const dir = baselinesDir(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = baselineFile(root, baseline.baseSha);
  writeFileSync(file, serializeBaseline(baseline), { mode: 0o600 });
  return file;
}

function readEvidence(root: string, file: string): IEvidence {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  const body = parsed as Partial<IEvidence>;
  if (!Array.isArray(body.checks) || typeof body.commit !== 'string') {
    throw new Error(`${file} is not a \`pnpm verify\` evidence document.`);
  }
  return body as IEvidence;
}

async function capture(
  root: string,
  profile: Profile,
  fromEvidence: string | null,
  log: (message: string) => void,
): Promise<{ baseline: IBaseline; file: string; exitCode: number }> {
  /*
   * The verify run comes first and the collection second, in one command,
   * because the test keys are read out of the JUnit that run just wrote.
   * `--from-evidence` reuses a run the coordinator already did, which is the
   * same ordering with the expensive half already paid for.
   */
  const evidence =
    fromEvidence === null
      ? (await runProfile({ root, profile, log })).evidence
      : readEvidence(root, fromEvidence);

  log('');
  log('Reading the violations each check named');
  const collected = collect({ root, log });

  const baseline = buildBaseline({
    capturedAt: new Date(),
    baseSha: evidence.commit,
    fingerprint: evidence.fingerprint,
    profile: evidence.profile,
    checks: evidence.checks,
    acknowledged: [],
    findings: collected.findings,
    sources: collected.sources,
  });

  const file = writeBaseline(root, baseline);
  const review = reviewBaseline(baseline);
  return {
    baseline,
    file,
    exitCode: review.blocked.length > 0 ? 2 : review.ok ? 0 : 1,
  };
}

function captureReport(baseline: IBaseline, file: string): string {
  const review = reviewBaseline(baseline);
  const lines = [
    '',
    `baseline ${baseline.baseSha} (profile ${baseline.profile}): ${review.ok ? 'GREEN' : 'RED'}`,
    `  ${String(baseline.findings.length)} key(s), ${String(totalFindings(baseline.findings))} violation(s)`,
    ...baseline.sources.map(
      (source) => `  ${source.status.padEnd(10)} ${source.id}: ${source.reason}`,
    ),
    `  written to ${file}`,
  ];
  const problems = formatReview(review);
  return [...lines, ...(problems === '' ? [] : ['', problems])].join('\n');
}

function gradeReport(grade: IGrade, current: ICollection, file: string): string {
  const lines = [
    '',
    `differential grade against ${file}: ${grade.grade.toUpperCase()} (${grade.reason})`,
    `  ${String(current.findings.length)} key(s) here, ${String(totalFindings(current.findings))} violation(s)`,
  ];
  if (grade.blocked.length > 0) {
    lines.push(
      'No evidence from:',
      ...grade.blocked.map((source) => `  ${source.id}: ${source.reason}`),
    );
  }
  const diff = formatDiff(grade.diff);
  const inherited = grade.diff.inherited.length;
  return [
    ...lines,
    ...(diff === '' ? [] : ['', diff]),
    '',
    `${String(inherited)} key(s) inherited from the base and not counted against this branch.`,
    ABSOLUTE_GATE_NOTICE,
  ].join('\n');
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  assertKnownFlags(
    parsed,
    ['profile', 'from-evidence', 'baseline', 'check', 'reason', 'json', 'help'],
    USAGE,
  );

  const root = process.cwd();
  const asJson = boolFlag(parsed, 'json');
  const log = (message: string): void => {
    (asJson ? process.stderr : process.stdout).write(`${message}\n`);
  };
  const emit = (document: unknown, text: string): void => {
    if (asJson) {
      process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    } else {
      log(text);
    }
  };

  if (boolFlag(parsed, 'help')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.command === null) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  switch (parsed.command) {
    case 'capture': {
      const captured = await capture(
        root,
        parseProfile(stringFlag(parsed, 'profile')),
        stringFlag(parsed, 'from-evidence'),
        log,
      );
      emit(
        {
          baseline: captured.baseline,
          file: captured.file,
          review: reviewBaseline(captured.baseline),
        },
        captureReport(captured.baseline, captured.file),
      );
      return captured.exitCode;
    }

    case 'compare': {
      const { baseline, file } = readBaseline(root, stringFlag(parsed, 'baseline'));
      const current = collect({ root, log });
      const grade = gradeAgainstBaseline(baseline, current);
      emit(
        { baseSha: baseline.baseSha, commit: current.commit, grade },
        gradeReport(grade, current, file),
      );
      return gradeExitCode(grade.grade);
    }

    case 'acknowledge': {
      const check = stringFlag(parsed, 'check');
      const reason = stringFlag(parsed, 'reason');
      if (check === null || reason === null) {
        throw new Error(`acknowledge needs --check=<id> and --reason="<why>".\n${USAGE}`);
      }
      const { baseline, file } = readBaseline(root, stringFlag(parsed, 'baseline'));
      const next = acknowledgeInto(baseline, check, reason, new Date());
      writeBaseline(root, next);
      emit({ baseline: next, file, review: reviewBaseline(next) }, captureReport(next, file));
      return reviewBaseline(next).ok ? 0 : 1;
    }

    case 'show': {
      const { baseline, file } = readBaseline(root, stringFlag(parsed, 'baseline'));
      emit({ baseline, file, review: reviewBaseline(baseline) }, captureReport(baseline, file));
      return reviewBaseline(baseline).ok ? 0 : 1;
    }

    default:
      throw new Error(`Unknown command "${parsed.command}".\n${USAGE}`);
  }
}

stopWritingOnClosedPipe();

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
