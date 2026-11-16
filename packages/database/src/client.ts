import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildSlowQueryExtension } from './slow-query.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const intEnv = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

// Pool sizing must match the deployment topology:
//   - single replica: DB_POOL_MAX = 10 (default).
//   - 2+ replicas of API or worker: total connections = replicas * DB_POOL_MAX
//     must be < Postgres `max_connections` minus headroom for migrations and
//     manual sessions. With managed Postgres at max=100, two API replicas at
//     10 each is safe; four replicas would be tight.
//   - Behind PgBouncer (transaction mode): set DB_POOL_MAX higher (e.g. 50)
//     since PgBouncer multiplexes onto fewer real connections, and add
//     `?pgbouncer=true` to DATABASE_URL.
//
// Statement / idle-in-transaction timeouts default to 30s / 60s. Adjust if
// long-running migrations or analytical queries hit them.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: intEnv('DB_POOL_MAX', 10),
  // Prevents silent connection hangs (Pitfall 2 in Prisma 7 driver-adapter docs).
  connectionTimeoutMillis: intEnv('DB_CONNECT_TIMEOUT_MS', 5000),
  idleTimeoutMillis: intEnv('DB_IDLE_TIMEOUT_MS', 10000),
  statement_timeout: intEnv('DB_STATEMENT_TIMEOUT_MS', 30000),
  idle_in_transaction_session_timeout: intEnv('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 60000),
});

// `$extends` returns a structurally-different (extended) client type, but the
// model surface (prisma.user.findMany etc.) is preserved. Cast back to
// `PrismaClient` so existing consumer types continue to compile. The slow-
// query extension is the *only* runtime difference: every operation is
// timed, and queries above `slow-query.thresholdMs` (default 200 ms) emit a
// structured warn to stdout. The `@prisma/instrumentation` auto-
// instrumentation continues to create per-query spans independently: keep
// the two complementary, no histogram is emitted from this hook.
export const prisma = new PrismaClient({ adapter }).$extends(
  buildSlowQueryExtension(),
) as unknown as PrismaClient;

export {
  setRequestContextResolver,
  setSlowQueryThresholdMs,
  type SlowQueryRequestContext,
} from './slow-query.js';
