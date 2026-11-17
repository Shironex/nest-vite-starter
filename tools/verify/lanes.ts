/*
 * The lanes `pnpm verify` runs, in order. A lane is a named list of commands,
 * each an argv run from the repo root. Every command is an existing package
 * script or turbo task, so a lane never does anything you could not type
 * yourself; verify only sequences them and reports.
 */
export interface ILane {
  readonly id: string;
  readonly description: string;
  readonly commands: readonly (readonly string[])[];
}

export const LANES: readonly ILane[] = [
  {
    id: 'format',
    description: 'Prettier check over the whole tree.',
    commands: [['pnpm', 'format:check']],
  },
  {
    id: 'lint',
    description: 'ESLint in every package and tools/, then the lint-meta rules and their catalog.',
    commands: [
      ['pnpm', 'exec', 'turbo', 'lint'],
      ['pnpm', 'lint:tools'],
      ['pnpm', 'lint:meta'],
      ['pnpm', 'lint:meta:docs', '--check'],
    ],
  },
  {
    id: 'typecheck',
    description: 'tsc in every package and tools/.',
    commands: [
      ['pnpm', 'exec', 'turbo', 'check-types'],
      ['pnpm', 'check-types:tools'],
    ],
  },
  {
    id: 'test',
    description: 'Unit tests in every package (api jest, web and ui vitest) and the tools tests.',
    commands: [
      ['pnpm', 'exec', 'turbo', 'test'],
      ['pnpm', 'test:tools'],
    ],
  },
  {
    id: 'build',
    description: 'Production build of every app and package.',
    commands: [['pnpm', 'exec', 'turbo', 'build']],
  },
];

export interface ISelection {
  readonly lanes: readonly ILane[];
  /** Git ref turbo compares against for `--affected`, or null for a full run. */
  readonly affectedBase: string | null;
}

export const USAGE = `Usage: pnpm verify [--lane=<id>]... [--affected[=<base>]] [--list]

  --lane=<id>        Run only this lane (repeat, or comma-separate). Default: every lane.
  --affected[=base]  turbo tasks run only for packages changed since <base>
                     (default origin/main). Non-turbo commands still run in full.
  --list             Print the lanes and their commands, run nothing.

Lanes: ${LANES.map((lane) => lane.id).join(', ')}.
Exit code: 0 when every lane passed, 1 when one failed, 2 on a usage error.`;

export class UsageError extends Error {}

/** Parse argv into the lanes to run. Unknown flags and lanes are usage errors. */
export function parseSelection(argv: readonly string[]): ISelection & { readonly list: boolean } {
  const ids: string[] = [];
  let affectedBase: string | null = null;
  let list = false;

  for (const arg of argv) {
    if (arg === '--list') {
      list = true;
    } else if (arg === '--affected') {
      affectedBase = 'origin/main';
    } else if (arg.startsWith('--affected=')) {
      affectedBase = arg.slice('--affected='.length);
      if (affectedBase === '') throw new UsageError(`--affected= needs a ref.\n${USAGE}`);
    } else if (arg.startsWith('--lane=')) {
      ids.push(...arg.slice('--lane='.length).split(',').filter(Boolean));
    } else {
      throw new UsageError(`Unknown argument "${arg}".\n${USAGE}`);
    }
  }

  const unknown = ids.filter((id) => !LANES.some((lane) => lane.id === id));
  if (unknown.length > 0) {
    throw new UsageError(`Unknown lane(s): ${unknown.join(', ')}.\n${USAGE}`);
  }

  // Lanes always run in the declared order, whatever order they were asked in.
  const lanes = ids.length === 0 ? LANES : LANES.filter((lane) => ids.includes(lane.id));
  return { lanes, affectedBase, list };
}

/** The argv a command runs with: turbo tasks get `--affected` in affected mode. */
export function commandFor(command: readonly string[], affectedBase: string | null): string[] {
  const isTurbo = command[0] === 'pnpm' && command[1] === 'exec' && command[2] === 'turbo';
  return isTurbo && affectedBase !== null ? [...command, '--affected'] : [...command];
}
