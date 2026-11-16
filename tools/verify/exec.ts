import { spawnSync } from 'node:child_process';

/*
 * Child processes get an env built from an explicit allowlist plus whatever the
 * caller passes, never a copy of the ambient shell. A worktree inherits the
 * DATABASE_URL, REDIS_URL or PORT of whatever the developer last exported, and
 * every consumer in this repo lets a real env var win over `.env`, so an
 * inherited value would silently point a sandbox lane back at the dev stack.
 */
const PASSTHROUGH = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'USER'];

export interface IRunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export function childEnv(extra: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

/*
 * Variables that name a service. A repo script inherits the developer's shell,
 * and this harness exists so a lane talks to its own sandbox: an exported
 * DATABASE_URL wins over `.env` everywhere in this repo, so leaving one in the
 * environment of a verify check would point it back at the dev stack.
 */
const SERVICE_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'PORT',
  'APP_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'PLAYWRIGHT_BASE_URL',
];

/** The ambient environment minus every service variable, plus `extra`. */
export function inheritedEnv(extra: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SERVICE_VARS.includes(key)) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

export interface IRunOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Stream to this process's stdio instead of capturing. */
  readonly inherit?: boolean;
  /**
   * With `inherit`, send the child's stdout to THIS process's stderr.
   *
   * For a caller whose own stdout carries a document (`pnpm verify --json`):
   * an inherited child writes straight to fd 1, so turbo's progress and the
   * evidence JSON would share the stream and neither could be piped.
   */
  readonly stdoutToStderr?: boolean;
  readonly timeoutMs?: number;
  /** Keep the ambient environment (minus service variables) instead of the allowlist. */
  readonly inheritEnv?: boolean;
}

export function run(command: string, args: readonly string[], options: IRunOptions): IRunResult {
  const startedAt = Date.now();
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: (options.inheritEnv === true ? inheritedEnv : childEnv)(options.env ?? {}),
    encoding: 'utf8',
    stdio:
      options.inherit === true
        ? options.stdoutToStderr === true
          ? ['inherit', 2, 2]
          : 'inherit'
        : 'pipe',
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });

  const durationMs = Date.now() - startedAt;
  if (result.error !== undefined) {
    return { status: 127, stdout: '', stderr: result.error.message, durationMs };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs,
  };
}

/** Poll `probe` until it returns true. Returns false when the deadline passes. */
export async function waitFor(
  probe: () => boolean | Promise<boolean>,
  options: {
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly abort?: () => string | null;
  },
): Promise<string | null> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const aborted = options.abort?.() ?? null;
    if (aborted !== null) {
      return aborted;
    }
    if (await probe()) {
      return null;
    }
    if (Date.now() >= deadline) {
      return `timed out after ${options.timeoutMs}ms`;
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

/**
 * Block the calling thread for `ms`.
 *
 * `Atomics.wait` on a throwaway buffer, because the callers here are synchronous
 * probe loops built on `spawnSync`, and making them async would spread `await`
 * through code whose whole job is to run one command and look at the result.
 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
