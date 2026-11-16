import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';

// Same two-file load as prisma/seed.ts, prisma/dev.seed.ts and
// prisma.config.ts, and for the same reason: bare `dotenv/config` reads only
// `<cwd>/.env`, which is packages/database when pnpm runs this script. Nearest
// first, and dotenv never overwrites an already-set key, so the real process
// environment still wins over both files and a package-local .env wins over the
// workspace root. Cosmetic for LOAD_USERS / LOAD_USER_PASSWORD (both have
// literal defaults below), load-bearing for DATABASE_URL on a fresh clone where
// packages/database/.env does not exist yet.
loadEnvFile({ quiet: true });
loadEnvFile({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

/**
 * Load-test user pool. Creates N disposable users so a k6 run can spread its
 * virtual users across distinct accounts, required because the app caps each
 * user at MAX_SESSIONS=3 concurrent sessions (session.service.ts), so many VUs
 * sharing one user would evict each other and 401.
 *
 * Users:    load-user-0@example.test … load-user-{N-1}@example.test
 * Password: LOAD_USER_PASSWORD (default "load-test-password", must match the
 *           POOL_PASSWORD default in load/k6/lib/config.js).
 * Count:    LOAD_USERS (default 50)
 *
 * Idempotent: re-runs UPSERT each account AND reset its lockout counters
 * (failedAttempts / lockedUntil / lockoutCount). That reset is the point: a
 * prior failing load run can lock these accounts, and a plain re-seed must hand
 * back login-able users, not stay poisoned. TEST-ONLY: refuses to run against
 * NODE_ENV=production.
 *
 *   pnpm --filter @repo/database db:seed:load            # 50 users
 *   LOAD_USERS=20 pnpm --filter @repo/database db:seed:load
 *
 * The load CLI auto-runs this for pool scenarios (`node load/cli.mjs baseline
 * --users=N`), forwarding LOAD_USERS=N.
 */

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed load-test users against NODE_ENV=production.');
  process.exit(1);
}

const COUNT = Math.max(1, Number(process.env.LOAD_USERS) || 50);
const PASSWORD = process.env.LOAD_USER_PASSWORD || 'load-test-password';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});
const prisma = new PrismaClient({ adapter });

// Algorithm.Argon2id = 2 (const enum cannot be imported with verbatimModuleSyntax),
// same params the seed/login path uses.
const ARGON2_OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

async function seedUser(email: string, passwordHash: string, tenantId: string): Promise<void> {
  await prisma.user.upsert({
    where: { email },
    // Reset lockout state on every re-seed so a poisoned prior run can't keep
    // the pool unable to log in. tenantId is also set here so pools minted by
    // older runs get attached instead of staying in a pre-tenancy state.
    update: {
      passwordHash,
      emailVerified: true,
      failedAttempts: 0,
      lockoutCount: 0,
      lockedUntil: null,
      tenantId,
    },
    create: {
      email,
      passwordHash,
      displayName: email.split('@')[0] || 'Load User',
      role: 'USER',
      emailVerified: true,
      tenantId,
    },
  });
}

async function main(): Promise<void> {
  console.log(`Seeding ${COUNT} load-test users (load-user-0…${COUNT - 1}@example.test)…`);
  const passwordHash = await hash(PASSWORD, ARGON2_OPTS);

  // Same default organization as seed.ts: production users always carry a tenant
  // (registration provisions one per signup), so the load pool must too or
  // k6 runs would silently skip every tenant-scoped code path.
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default-organization' },
    update: {},
    create: { name: 'Default Organization', slug: 'default-organization' },
  });

  // Bounded concurrency so we don't exhaust the connection pool while staying quick.
  const BATCH = 8;
  for (let i = 0; i < COUNT; i += BATCH) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH, COUNT); j++) {
      batch.push(seedUser(`load-user-${j}@example.test`, passwordHash, tenant.id));
    }
    await Promise.all(batch);
    process.stdout.write(`  ${Math.min(i + BATCH, COUNT)}/${COUNT}\r`);
  }
  console.log(`\nLoad-test users seeded (password: "${PASSWORD}").`);
}

main()
  .catch((e) => {
    console.error('Load seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
