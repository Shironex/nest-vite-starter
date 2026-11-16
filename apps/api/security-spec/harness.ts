/**
 * The security lane's harness.
 *
 * Every helper here exists to remove one way a security spec can be green
 * without having proved anything:
 *
 * - `requirePostgresOrFail` / `requireRedisOrFail` THROW where the ordinary
 *   helpers return a boolean the caller is free to bail on. A finding whose
 *   service is not running is not "passing", it is unproven, and the reconciler
 *   has to be able to tell those apart.
 * - `specPrecondition` marks that difference on the wire: anything it throws
 *   carries {@link SPEC_INFRA_MARKER}, which
 *   `tools/quality/check-security-manifest.ts` reads as `blocked` rather than as
 *   evidence for or against the finding.
 * - `barrier` and `raceAll` (re-exported from the ordinary suite's
 *   `test/concurrency.ts`) force an overlap instead of hoping for one.
 *
 * Read `security-spec/README.md` before adding a file here.
 */
import type Redis from 'ioredis';
import IORedis from 'ioredis';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { esmImport } from '@/common/utils/esm-import';

export { barrier, raceAll } from '@test/concurrency';

/**
 * Prefix on every infrastructure failure this harness raises.
 *
 * The reconciler counts only a genuine assertion failure as evidence; a case
 * that died because Postgres was down is `blocked`, and a `blocked` case never
 * silently stands in for a passing one.
 */
export const SPEC_INFRA_MARKER = 'SPEC-INFRA';

/**
 * Fail the current case as INFRASTRUCTURE, never as evidence.
 *
 * Returns `never` so it can be thrown from an expression position and TypeScript
 * still narrows what follows.
 */
export function specPrecondition(message: string): never {
  throw new Error(`${SPEC_INFRA_MARKER}: ${message}`);
}

/** Whether an error came from {@link specPrecondition} (or carries its marker). */
export function isSpecInfraError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(SPEC_INFRA_MARKER);
}

/**
 * The env value `test/setup-env.ts` fills in when nothing exported a real one.
 * Reaching Postgres is the point of these specs, so the placeholder is refused
 * up front with the command that fixes it, rather than after a connection
 * timeout nobody can read.
 */
const PLACEHOLDER_DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const RUN_HINT = 'export DATABASE_URL=<a real database> && pnpm --filter @repo/api test:security';

let postgres: PrismaClient | undefined;

/**
 * The Prisma singleton, connected, or a thrown `SPEC-INFRA`.
 *
 * The singleton from `@repo/database` rather than `new PrismaClient()`: Prisma 7
 * needs a driver adapter and that package is where it is configured. Loaded
 * through `esmImport` for the reason that helper documents (the api compiles to
 * CJS; `@repo/database` is ESM-only).
 */
export async function requirePostgresOrFail(): Promise<PrismaClient> {
  if (postgres !== undefined) {
    return postgres;
  }

  const url = process.env.DATABASE_URL;
  if (url === undefined || url === PLACEHOLDER_DATABASE_URL) {
    specPrecondition(`DATABASE_URL is unset or still the test placeholder. ${RUN_HINT}`);
  }

  let client: PrismaClient;
  try {
    const loaded = (await esmImport('@repo/database')) as { prisma: PrismaClient };
    client = loaded.prisma;
    await client.$queryRaw`SELECT 1`;
  } catch (error) {
    specPrecondition(
      `Postgres is not reachable at DATABASE_URL (${(error as Error).message}). ${RUN_HINT}`,
    );
  }

  postgres = client;
  return client;
}

let redis: Redis | undefined;

/**
 * A connected ioredis client, or a thrown `SPEC-INFRA`.
 *
 * `lazyConnect` plus an explicit `connect()` so an unreachable Redis fails HERE,
 * with the reason, instead of surfacing later as a command that never settles.
 * `maxRetriesPerRequest: 0` for the same reason: this lane wants the first
 * failure, not a retry that turns an outage into a timeout.
 *
 * Callers are responsible for the data they write; use a database index other
 * than 0 and flush it in `afterAll`.
 */
export async function requireRedisOrFail(): Promise<Redis> {
  if (redis !== undefined) {
    return redis;
  }

  const url = process.env.REDIS_URL;
  if (url === undefined) {
    specPrecondition('REDIS_URL is unset, so the Redis-backed cases cannot run.');
  }

  const client = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    await client.ping();
  } catch (error) {
    client.disconnect();
    specPrecondition(`Redis is not reachable at REDIS_URL (${(error as Error).message}).`);
  }

  redis = client;
  return client;
}

/** Close whatever the harness opened. Call from `afterAll` in a spec that used Redis. */
export async function closeRedis(): Promise<void> {
  if (redis !== undefined) {
    await redis.quit();
    redis = undefined;
  }
}
