import { assertKnownFlags, boolFlag, parseArgs, stringFlag } from './args';
import { stopWritingOnClosedPipe } from './cli-io';
import type { Profile } from './result';
import { reproduceLines } from './result';
import { runProfile } from './runner';

const PROFILES: readonly Profile[] = ['static', 'feature', 'release'];

const USAGE = `Usage: pnpm verify [--profile=static|feature|release] [--json]

  static   lint, types, lint:meta, format and contrast. No services.
  feature  static plus the suites, knip, the coverage ratchets, the isolation
           lane and the Prisma gates, against a per-worktree sandbox.
  release  feature plus the bundle budget and the e2e lane. The profile a change
           is finished against.

--json puts the evidence document alone on stdout; run it through
\`pnpm --silent\` so pnpm's script banner does not land there too.

Exit codes: 0 passed, 1 failed, 2 blocked (a check that could not run, a report
that did not parse, a skipped case, or a tree that changed mid-run).`;

function parseProfile(value: string | null): Profile {
  if (value === null) {
    return 'static';
  }
  const profile = PROFILES.find((candidate) => candidate === value);
  if (profile === undefined) {
    throw new Error(`Unknown profile "${value}". Choose one of: ${PROFILES.join(', ')}.\n${USAGE}`);
  }
  return profile;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  assertKnownFlags(parsed, ['profile', 'json'], USAGE);

  const profile = parseProfile(stringFlag(parsed, 'profile'));
  const asJson = boolFlag(parsed, 'json');
  // With --json the object on stdout is the only thing on stdout, so it can be
  // piped: this process's progress AND every check's own output go to stderr.
  // Run it as `pnpm --silent verify --json`, or pnpm's own script banner lands
  // on stdout ahead of the document.
  const log = (message: string): void => {
    (asJson ? process.stderr : process.stdout).write(`${message}\n`);
  };

  const outcome = await runProfile({
    root: process.cwd(),
    profile,
    log,
    quietStdout: asJson,
  });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(outcome.evidence, null, 2)}\n`);
  } else {
    const rows = outcome.evidence.checks.map(
      (check) =>
        `  ${check.status.padEnd(15)} ${check.id.padEnd(22)} ${check.reason} (${check.durationMs}ms)`,
    );
    const reproduce = reproduceLines(outcome.evidence.checks);
    log(
      [
        '',
        `verify --profile=${profile}: ${outcome.evidence.execution.status}`,
        ...rows,
        outcome.evidence.execution.treeStable
          ? ''
          : '  the working tree changed during the run, so this result describes neither tree',
        ...reproduce,
        `  evidence: ${outcome.file}`,
      ]
        .filter((line) => line !== '')
        .join('\n'),
    );
  }

  return outcome.evidence.execution.exitCode;
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
