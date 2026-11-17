import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ISandboxDescriptor, ISandboxService } from './descriptor';
import {
  DESCRIPTOR_SCHEMA_VERSION,
  databaseUrl,
  listDescriptors,
  removeDescriptor,
  withPorts,
  writeDescriptor,
} from './descriptor';
import {
  boundPort,
  containersWithLabels,
  docker,
  dockerAvailable,
  dockerOrThrow,
  removeContainers,
  runArgs,
} from './docker';
import { run, waitFor, sleepSync } from './exec';
import type { ServiceImages } from './images';
import { parseServiceImages } from './images';
import { LANES, TEMPLATE_DATABASE } from './lanes';
import { LABEL_ID, LABEL_OWNER, LABEL_ROLE, ownerId } from './ownership';

const CI_WORKFLOW = join('.github', 'workflows', 'ci.yml');

/*
 * The sandbox user and password are literals, not secrets: the containers bind
 * loopback-only on a random port and hold nothing but generated test rows. They
 * match the CI service credentials so a lane URL differs from CI's in host and
 * port alone.
 */
const SANDBOX_USER = 'postgres';
const SANDBOX_PASSWORD = 'postgres';

/** The host port docker has bound right now, or null when it cannot say. */
function livePort(container: string, containerPort: string): number | null {
  const result = docker(['port', container, containerPort]);
  if (result.status !== 0) {
    return null;
  }
  const [first] = result.stdout.trim().split('\n');
  const bound = Number((first ?? '').trim().split(':').pop());
  return Number.isInteger(bound) && bound > 0 ? bound : null;
}

export function containerName(id: string, role: string): string {
  return `nest-vite-starter-sbx-${id}-${role}`;
}

export function readImages(root: string): ServiceImages {
  return parseServiceImages(readFileSync(join(root, CI_WORKFLOW), 'utf8'));
}

function startService(
  id: string,
  owner: string,
  role: string,
  image: string,
  env: Readonly<Record<string, string>>,
  ports: readonly string[],
  extraArgs: readonly string[] = [],
): ISandboxService {
  const name = containerName(id, role);
  dockerOrThrow(
    runArgs({
      name,
      image,
      labels: { [LABEL_OWNER]: owner, [LABEL_ID]: id, [LABEL_ROLE]: role },
      env,
      ports,
      extraArgs,
    }),
  );

  const bound: Record<string, number> = {};
  for (const port of ports) {
    bound[port] = boundPort(name, port);
  }
  return { container: name, image, ports: bound };
}

function psql(container: string, sql: string): void {
  const result = docker([
    'exec',
    container,
    'psql',
    '-U',
    SANDBOX_USER,
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
  if (result.status !== 0) {
    throw new Error(`psql failed: ${sql}\n${result.stderr.trim()}`);
  }
}

function pgIsReady(container: string): boolean {
  return (
    docker(['exec', container, 'pg_isready', '-U', SANDBOX_USER, '-d', 'postgres']).status === 0
  );
}

/*
 * One `pg_isready` is not enough, because the postgres image answers it twice.
 * The entrypoint runs a TEMPORARY server so it can initialize the cluster, then
 * stops it and starts the real one. A probe landing in that window is told the
 * server is ready, and the very next command fails with "No such file or
 * directory" on the socket, because the temporary server has gone.
 *
 * That is what `pnpm sandbox:up` once did: `CREATE DATABASE
 * nest_vite_starter_template` failed the moment after readiness was confirmed, and because
 * `up` had already written its descriptor, the NEXT `up` took the reuse branch
 * and failed differently, complaining that the template did not exist.
 *
 * Requiring consecutive successes spans the restart: the streak breaks when the
 * temporary server stops.
 */
const READY_STREAK = 5;
const READY_INTERVAL_MS = 250;

function postgresReady(container: string): boolean {
  for (let attempt = 0; attempt < READY_STREAK; attempt += 1) {
    if (!pgIsReady(container)) return false;
    if (attempt < READY_STREAK - 1) sleepSync(READY_INTERVAL_MS);
  }
  return true;
}

export interface IUpResult {
  readonly descriptor: ISandboxDescriptor;
  readonly file: string;
  readonly migrateMs: number;
  readonly lanesMs: number;
}

export async function up(root: string): Promise<IUpResult> {
  if (!dockerAvailable()) {
    throw new Error(
      'Docker is not running. Start it and retry; the sandbox is plain `docker run`, no compose.',
    );
  }

  const owner = ownerId(root);
  const id = randomBytes(4).toString('hex');
  const images = readImages(root);

  const postgres = startService(
    id,
    owner,
    'postgres',
    images.postgres,
    {
      POSTGRES_USER: SANDBOX_USER,
      POSTGRES_PASSWORD: SANDBOX_PASSWORD,
      POSTGRES_DB: 'postgres',
    },
    ['5432'],
  );
  const redis = startService(id, owner, 'redis', images.redis, {}, ['6379']);
  const mailpit = startService(
    id,
    owner,
    'mailpit',
    images.mailpit,
    { MP_SMTP_AUTH_ACCEPT_ANY: '1', MP_SMTP_AUTH_ALLOW_INSECURE: '1' },
    ['1025', '8025'],
  );
  const services: Readonly<Record<string, ISandboxService>> = { postgres, redis, mailpit };

  const descriptor: ISandboxDescriptor = {
    schemaVersion: DESCRIPTOR_SCHEMA_VERSION,
    id,
    owner,
    root,
    createdAt: new Date().toISOString(),
    user: SANDBOX_USER,
    password: SANDBOX_PASSWORD,
    services,
  };
  /*
   * The descriptor is written LAST, and a failure takes the containers with it.
   *
   * It is the thing `sandbox:up` reads to decide "already running, just reset
   * the lanes". Writing it before the template and lanes exist means a failure
   * anywhere below leaves a descriptor describing a sandbox that was never
   * finished, and the next `up` then takes the reuse branch and fails with
   * something unrelated ("template database nest_vite_starter_template does not exist")
   * instead of the original error. `down` finds containers by label, not by
   * descriptor, so cleaning up without one is safe.
   */
  const pg = postgres.container;
  try {
    const notReady = await waitFor(() => postgresReady(pg), { timeoutMs: 60_000, intervalMs: 500 });
    if (notReady !== null) {
      throw new Error(`Postgres never became ready in sandbox ${id} (${notReady}).`);
    }

    const migrateStartedAt = Date.now();
    psql(pg, `CREATE DATABASE ${TEMPLATE_DATABASE}`);
    const migrate = run('pnpm', ['--filter', '@repo/database', 'db:migrate:deploy'], {
      cwd: root,
      env: { DATABASE_URL: databaseUrl(descriptor, TEMPLATE_DATABASE) },
    });
    if (migrate.status !== 0) {
      throw new Error(
        `Migrating the template database failed:\n${migrate.stdout}\n${migrate.stderr}`,
      );
    }
    const migrateMs = Date.now() - migrateStartedAt;

    const lanesStartedAt = Date.now();
    createLanes(descriptor);
    const lanesMs = Date.now() - lanesStartedAt;

    const file = writeDescriptor(root, descriptor);
    return { descriptor, file, migrateMs, lanesMs };
  } catch (error) {
    removeContainers(Object.values(services).map((service) => service.container));
    throw error;
  }
}

/**
 * (Re)create every lane database from the migrated template. `CREATE DATABASE
 * ... TEMPLATE` copies the files, so this is seconds rather than one migrate
 * replay per lane, and it needs no open connection to the template.
 */
export function createLanes(descriptor: ISandboxDescriptor, laneIds?: readonly string[]): void {
  const pg = descriptor.services['postgres']?.container;
  if (pg === undefined) {
    throw new Error(`Sandbox ${descriptor.id} has no postgres container.`);
  }
  for (const lane of LANES) {
    if (laneIds !== undefined && !laneIds.includes(lane.id)) {
      continue;
    }
    psql(pg, `DROP DATABASE IF EXISTS ${lane.database} WITH (FORCE)`);
    psql(pg, `CREATE DATABASE ${lane.database} TEMPLATE ${TEMPLATE_DATABASE}`);
  }
}

export interface IDownResult {
  readonly containersRemoved: number;
  readonly descriptorsRemoved: number;
}

/**
 * Remove only what this worktree labeled. Never a prune and never a name
 * pattern: `docker ps -a --filter label=nest-vite-starter.sandbox.owner=<sha>` cannot
 * select the user's `nest-vite-starter-*` dev containers, which carry no such label.
 * Running it twice is a no-op, not an error.
 */
export function down(root: string, id?: string): IDownResult {
  const owner = ownerId(root);
  const labels: Record<string, string> = { [LABEL_OWNER]: owner };
  if (id !== undefined) {
    labels[LABEL_ID] = id;
  }

  const containersRemoved = dockerAvailable() ? removeContainers(containersWithLabels(labels)) : 0;

  let descriptorsRemoved = 0;
  for (const stored of listDescriptors(root, owner)) {
    if (id !== undefined && stored.descriptor.id !== id) {
      continue;
    }
    removeDescriptor(stored.file);
    descriptorsRemoved += 1;
  }

  return { containersRemoved, descriptorsRemoved };
}

/**
 * The newest live sandbox this worktree owns, or null. Host ports are re-read
 * from docker and the descriptor rewritten when they moved: a restarted
 * container is published on a NEW ephemeral port, and a descriptor still naming
 * the old one sends every lane at a port that answers for nobody.
 */
export function current(root: string): ISandboxDescriptor | null {
  const owner = ownerId(root);
  for (const stored of listDescriptors(root, owner)) {
    const running = containersWithLabels({
      [LABEL_OWNER]: owner,
      [LABEL_ID]: stored.descriptor.id,
    });
    if (running.length === 0) {
      continue;
    }

    const refreshed = withPorts(stored.descriptor, livePort);
    if (JSON.stringify(refreshed) !== JSON.stringify(stored.descriptor)) {
      writeDescriptor(root, refreshed);
    }
    return refreshed;
  }
  return null;
}
