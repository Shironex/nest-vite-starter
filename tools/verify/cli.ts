import { spawnSync } from 'node:child_process';

import { commandFor, parseSelection, UsageError, USAGE } from './lanes';

/*
 * `pnpm verify`: run the selected lanes in order, streaming each command's own
 * output, then print one summary line per lane. A failed lane does not stop
 * the next one, so a single run shows every red lane. Nothing is cached or
 * written: turbo already caches the tasks underneath.
 */

interface ILaneResult {
  readonly id: string;
  readonly passed: boolean;
  readonly failedCommand: string | null;
  readonly durationMs: number;
}

function run(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const [program = '', ...args] = argv;
  const result = spawnSync(program, args, {
    stdio: 'inherit',
    env,
    // pnpm is a .cmd shim on Windows, which only a shell can start. Every
    // argument is a fixed string from lanes.ts, never user input.
    shell: process.platform === 'win32',
  });
  return result.status ?? 1;
}

function main(): number {
  let selection;
  try {
    selection = parseSelection(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (selection.list) {
    for (const lane of selection.lanes) {
      process.stdout.write(`${lane.id}: ${lane.description}\n`);
      for (const command of lane.commands) process.stdout.write(`  ${command.join(' ')}\n`);
    }
    process.stdout.write(`\n${USAGE}\n`);
    return 0;
  }

  const env =
    selection.affectedBase === null
      ? process.env
      : { ...process.env, TURBO_SCM_BASE: selection.affectedBase };

  const results: ILaneResult[] = [];
  for (const lane of selection.lanes) {
    const startedAt = Date.now();
    let failedCommand: string | null = null;
    for (const command of lane.commands) {
      const argv = commandFor(command, selection.affectedBase);
      process.stdout.write(`\nverify [${lane.id}] > ${argv.join(' ')}\n`);
      if (run(argv, env) !== 0) {
        failedCommand = argv.join(' ');
        break;
      }
    }
    results.push({
      id: lane.id,
      passed: failedCommand === null,
      failedCommand,
      durationMs: Date.now() - startedAt,
    });
  }

  const failed = results.filter((result) => !result.passed);
  const affected =
    selection.affectedBase === null ? '' : ` (affected since ${selection.affectedBase})`;
  process.stdout.write(`\nverify${affected}: ${failed.length === 0 ? 'passed' : 'failed'}\n`);
  for (const result of results) {
    const status = result.passed ? 'passed' : 'FAILED';
    const seconds = (result.durationMs / 1000).toFixed(1);
    const detail = result.failedCommand === null ? '' : `  reproduce: ${result.failedCommand}`;
    process.stdout.write(`  ${status.padEnd(7)} ${result.id.padEnd(10)} ${seconds}s${detail}\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

process.exitCode = main();
