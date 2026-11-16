/*
 * The three CLIs in tools/verify take a verb plus `--flag` / `--flag=value`
 * switches and nothing else, so they parse their own argv rather than take a
 * dependency. An unknown flag is the caller's typo and must not be ignored.
 */
export interface IParsedArgs {
  readonly command: string | null;
  readonly flags: Readonly<Record<string, string | true>>;
}

export function parseArgs(argv: readonly string[]): IParsedArgs {
  let command: string | null = null;
  const flags: Record<string, string | true> = {};

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      command ??= arg;
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      flags[body] = true;
    } else {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    }
  }

  return { command, flags };
}

export function assertKnownFlags(
  parsed: IParsedArgs,
  known: readonly string[],
  usage: string,
): void {
  const unknown = Object.keys(parsed.flags).filter((flag) => !known.includes(flag));
  if (unknown.length > 0) {
    throw new Error(`Unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}\n${usage}`);
  }
}

export function stringFlag(parsed: IParsedArgs, name: string): string | null {
  const value = parsed.flags[name];
  return typeof value === 'string' ? value : null;
}

export function boolFlag(parsed: IParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}
