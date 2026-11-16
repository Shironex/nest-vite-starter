import { assertKnownFlags, parseArgs } from './args';
import { stopWritingOnClosedPipe } from './cli-io';
import { current } from './sandbox-lifecycle';
import { runE2eLane } from './e2e-runtime';

const USAGE = `Usage: pnpm e2e:lane [-- <playwright args>]

Runs the Playwright suite against this worktree's sandbox: a database recreated
from the migrated template and seeded the way CI seeds it, the built api and
\`vite preview\`, both on free ports. Start the sandbox first with \`pnpm sandbox:up\`.`;

async function main(): Promise<number> {
  const separator = process.argv.indexOf('--');
  const own = separator === -1 ? process.argv.slice(2) : process.argv.slice(2, separator);
  const playwrightArgs = separator === -1 ? [] : process.argv.slice(separator + 1);

  assertKnownFlags(parseArgs(own), [], USAGE);

  const root = process.cwd();
  const descriptor = current(root);
  if (descriptor === null) {
    process.stderr.write(
      'No sandbox is running for this worktree. Run `pnpm sandbox:up` first; the e2e lane never falls back to an ambient server.\n',
    );
    return 2;
  }

  const result = await runE2eLane({ root, descriptor, playwrightArgs });
  return result.status;
}

stopWritingOnClosedPipe();

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
