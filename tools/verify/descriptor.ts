import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ILane } from './lanes';
import { sandboxesDir } from './ownership';

/*
 * A running sandbox is described by one JSON file per sandbox id, written 0600
 * into a gitignored directory. The file carries the bound host ports, which is
 * what every consumer (the integration lane, the Prisma gates, the e2e lane)
 * needs and what nothing can reconstruct once the run that created them ends.
 *
 * Credentials never reach stdout: `sandbox:inspect` prints ports and lane ids,
 * and a consumer that needs a URL asks for one command at a time.
 */
export const DESCRIPTOR_SCHEMA_VERSION = 1;

export interface ISandboxService {
  readonly container: string;
  readonly image: string;
  /** Container port (as written in the image) mapped to its 127.0.0.1 host port. */
  readonly ports: Readonly<Record<string, number>>;
}

export interface ISandboxDescriptor {
  readonly schemaVersion: number;
  readonly id: string;
  readonly owner: string;
  readonly root: string;
  readonly createdAt: string;
  readonly user: string;
  readonly password: string;
  readonly services: Readonly<Record<string, ISandboxService>>;
}

export function descriptorPath(root: string, id: string): string {
  return join(sandboxesDir(root), `${id}.json`);
}

export function writeDescriptor(root: string, descriptor: ISandboxDescriptor): string {
  const dir = sandboxesDir(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = descriptorPath(root, descriptor.id);
  writeFileSync(file, `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function isService(value: unknown): value is ISandboxService {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ISandboxService>;
  return (
    typeof candidate.container === 'string' &&
    typeof candidate.image === 'string' &&
    typeof candidate.ports === 'object' &&
    candidate.ports !== null &&
    Object.values(candidate.ports).every((port) => typeof port === 'number')
  );
}

/** Parse a descriptor, returning null when it is missing, unreadable or malformed. */
export function parseDescriptor(text: string): ISandboxDescriptor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const candidate = parsed as Partial<ISandboxDescriptor>;
  if (
    candidate.schemaVersion !== DESCRIPTOR_SCHEMA_VERSION ||
    typeof candidate.id !== 'string' ||
    typeof candidate.owner !== 'string' ||
    typeof candidate.root !== 'string' ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.user !== 'string' ||
    typeof candidate.password !== 'string' ||
    typeof candidate.services !== 'object' ||
    candidate.services === null ||
    !Object.values(candidate.services).every(isService)
  ) {
    return null;
  }

  return candidate as ISandboxDescriptor;
}

export function readDescriptor(file: string): ISandboxDescriptor | null {
  if (!existsSync(file)) {
    return null;
  }
  return parseDescriptor(readFileSync(file, 'utf8'));
}

export interface IStoredDescriptor {
  readonly file: string;
  readonly descriptor: ISandboxDescriptor;
}

/** Every well-formed descriptor this worktree owns, newest first. */
export function listDescriptors(root: string, owner: string): IStoredDescriptor[] {
  const dir = sandboxesDir(root);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name))
    .map((file) => ({ file, descriptor: readDescriptor(file) }))
    .filter((entry): entry is IStoredDescriptor => entry.descriptor !== null)
    .filter((entry) => entry.descriptor.owner === owner)
    .sort((a, b) => b.descriptor.createdAt.localeCompare(a.descriptor.createdAt));
}

export function removeDescriptor(file: string): void {
  rmSync(file, { force: true });
}

/**
 * A descriptor with the given host ports substituted in. Docker hands a
 * container a NEW ephemeral host port every time it is started, so a `docker
 * restart` (or a Docker Desktop restart) silently invalidates every URL the
 * descriptor holds; a lookup that fails keeps the recorded value, so a stopped
 * container stays addressable-looking and fails its reachability probe instead
 * of disappearing.
 */
export function withPorts(
  descriptor: ISandboxDescriptor,
  lookup: (container: string, port: string) => number | null,
): ISandboxDescriptor {
  const services: Record<string, ISandboxService> = {};
  for (const [role, service] of Object.entries(descriptor.services)) {
    const ports: Record<string, number> = {};
    for (const [containerPort, hostPort] of Object.entries(service.ports)) {
      ports[containerPort] = lookup(service.container, containerPort) ?? hostPort;
    }
    services[role] = { ...service, ports };
  }
  return { ...descriptor, services };
}

export function servicePort(descriptor: ISandboxDescriptor, service: string, port: string): number {
  const bound = descriptor.services[service]?.ports[port];
  if (bound === undefined) {
    throw new Error(
      `Sandbox ${descriptor.id} has no host port for ${service}:${port}. Recreate it with \`pnpm sandbox:up\`.`,
    );
  }
  return bound;
}

export function databaseUrl(descriptor: ISandboxDescriptor, database: string): string {
  const port = servicePort(descriptor, 'postgres', '5432');
  return `postgresql://${descriptor.user}:${descriptor.password}@127.0.0.1:${port}/${database}`;
}

export function laneDatabaseUrl(descriptor: ISandboxDescriptor, lane: ILane): string {
  return databaseUrl(descriptor, lane.database);
}

export function laneRedisUrl(descriptor: ISandboxDescriptor, lane: ILane): string {
  return `redis://127.0.0.1:${servicePort(descriptor, 'redis', '6379')}/${lane.redisDb}`;
}

export function smtpPort(descriptor: ISandboxDescriptor): number {
  return servicePort(descriptor, 'mailpit', '1025');
}

export function mailpitHttpUrl(descriptor: ISandboxDescriptor): string {
  return `http://127.0.0.1:${servicePort(descriptor, 'mailpit', '8025')}`;
}
