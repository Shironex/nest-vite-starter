/*
 * A sandbox holds one Postgres, one Redis and one mailpit, and the lanes below
 * divide them. Each lane owns a database and a Redis db index, so the isolation
 * specs, the Prisma gates and the e2e run can share a sandbox without seeing
 * each other's rows or keys.
 *
 * Databases are created from `TEMPLATE_DATABASE`, which is migrated once when
 * the sandbox comes up. `CREATE DATABASE x TEMPLATE y` is a file copy, so a
 * lane is recreated fresh in about a second instead of replaying every
 * migration. Redis db 0 is deliberately unused: it is what a URL with no index
 * selects, so leaving it empty makes an unconfigured consumer obvious.
 */
export type LaneId = 'isolation' | 'e2e' | 'prisma_gates';

export interface ILane {
  readonly id: LaneId;
  readonly database: string;
  readonly redisDb: number;
}

export const TEMPLATE_DATABASE = 'nest_vite_starter_template';

export const LANES: readonly ILane[] = [
  { id: 'isolation', database: 'nest_vite_starter_isolation', redisDb: 1 },
  { id: 'e2e', database: 'nest_vite_starter_e2e', redisDb: 2 },
  { id: 'prisma_gates', database: 'nest_vite_starter_prisma_gates', redisDb: 3 },
];

export function laneById(id: string): ILane {
  const lane = LANES.find((candidate) => candidate.id === id);
  if (lane === undefined) {
    throw new Error(`Unknown lane "${id}". Known lanes: ${LANES.map((l) => l.id).join(', ')}.`);
  }
  return lane;
}
