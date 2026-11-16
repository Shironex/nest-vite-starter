import { spawnSync } from 'node:child_process';

/*
 * Plain `docker run`, never `docker compose`. Compose would need a project
 * name, and the repo pins one so the dev stack cannot be hijacked; a worktree
 * borrowing that project is exactly the collision the sandbox exists to avoid.
 *
 * Host ports are always published as `127.0.0.1::<container port>`: loopback
 * only, and the host side left to the kernel. Nothing here may bind a fixed
 * port, because the dev stack already owns 5432, 6379, 1025 and 8025.
 */
export interface IExecResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface IContainerSpec {
  readonly name: string;
  readonly image: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
  /** Container ports to publish. The host side is always random and loopback-bound. */
  readonly ports: readonly string[];
  readonly extraArgs?: readonly string[];
}

export function docker(args: readonly string[]): IExecResult {
  const result = spawnSync('docker', [...args], { encoding: 'utf8' });
  if (result.error !== undefined) {
    return { status: 127, stdout: '', stderr: result.error.message };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function dockerOrThrow(args: readonly string[]): string {
  const result = docker(args);
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed (${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function dockerAvailable(): boolean {
  return docker(['info', '--format', '{{.ServerVersion}}']).status === 0;
}

export function runArgs(spec: IContainerSpec): string[] {
  const args = ['run', '-d', '--name', spec.name];

  for (const [key, value] of Object.entries(spec.labels)) {
    args.push('--label', `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(spec.env)) {
    args.push('-e', `${key}=${value}`);
  }
  for (const port of spec.ports) {
    args.push('-p', `127.0.0.1::${port}`);
  }
  args.push(...(spec.extraArgs ?? []));
  args.push(spec.image);

  return args;
}

/** Host port bound to `containerPort`, read back from docker after the run. */
export function boundPort(container: string, containerPort: string): number {
  const mapping = dockerOrThrow(['port', container, containerPort]);
  const [first] = mapping.split('\n');
  const port = Number((first ?? '').trim().split(':').pop());
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `Could not read the host port for ${container}:${containerPort} (got "${mapping}").`,
    );
  }
  return port;
}

/** Container ids carrying every one of the given labels, running or not. */
export function containersWithLabels(labels: Readonly<Record<string, string>>): string[] {
  const args = ['ps', '-a', '--quiet'];
  for (const [key, value] of Object.entries(labels)) {
    args.push('--filter', `label=${key}=${value}`);
  }
  return docker(args)
    .stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Remove the given containers and the anonymous volumes they created. Never a
 * prune: only ids the caller selected by this worktree's labels, and removing
 * an id that is already gone is not an error.
 */
export function removeContainers(ids: readonly string[]): number {
  let removed = 0;
  for (const id of ids) {
    if (docker(['rm', '--force', '--volumes', id]).status === 0) {
      removed += 1;
    }
  }
  return removed;
}
