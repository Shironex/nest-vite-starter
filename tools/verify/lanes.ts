/*
 * A sandbox holds one Postgres, one Redis, one s3rver and one mailpit, and the
 * lanes below divide them. Each lane owns a database, a Redis db index and a
 * bucket, so the isolation specs, the Prisma gates and the e2e run can share a
 * sandbox without seeing each other's rows, keys or objects.
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
  readonly bucket: string;
}

export const TEMPLATE_DATABASE = 'saas_starter_template';

export const LANES: readonly ILane[] = [
  {
    id: 'isolation',
    database: 'saas_starter_isolation',
    redisDb: 1,
    bucket: 'saas-starter-isolation',
  },
  // The e2e bucket keeps CI's name: the api reads S3_BUCKET and the CI job sets
  // `saas-starter-uploads`, so a different name here would only be exercised locally.
  { id: 'e2e', database: 'saas_starter_e2e', redisDb: 2, bucket: 'saas-starter-uploads' },
  {
    id: 'prisma_gates',
    database: 'saas_starter_prisma_gates',
    redisDb: 3,
    bucket: 'saas-starter-gates',
  },
];

export function laneById(id: string): ILane {
  const lane = LANES.find((candidate) => candidate.id === id);
  if (lane === undefined) {
    throw new Error(`Unknown lane "${id}". Known lanes: ${LANES.map((l) => l.id).join(', ')}.`);
  }
  return lane;
}
