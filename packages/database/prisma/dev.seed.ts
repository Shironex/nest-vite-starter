/**
 * DEV PLAYGROUND SEED
 *
 * `prisma/seed.ts` is the BASELINE seed: the admin, the member and the e2e
 * fixture accounts. It is a bootstrap, not a dataset.
 *
 * This script adds a small, fixed playground on top: two more user accounts
 * and an audit trail, so the admin screens have something to render without a
 * human creating rows by hand. Together with the baseline admin that is one
 * admin plus two playground users.
 *
 * It re-creates nothing that `seed.ts` owns. Run order:
 *
 *   pnpm --filter @repo/database db:seed        # baseline (admin, member, e2e)
 *   pnpm --filter @repo/database db:seed:dev    # this file
 *
 * `db:seed:dev` chains both, so `pnpm db:seed:dev` from the repo root is enough.
 *
 * Add your product's own playground rows here, and extend `resetPlayground`
 * and `verifySeed` for every table you add.
 *
 * ARGON2_OPTIONS mirrors apps/api/src/modules/auth/services/password.service.ts:
 * nothing below imports from apps/api (it compiles to CJS while this package is
 * ESM-only), so a change there has to be repeated here.
 */
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnvFile } from 'dotenv';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

// Nearest first, and dotenv never overwrites an already-set key: the real
// process environment (a CI step env, an exported shell var, turbo's globalEnv
// passthrough) wins over both files, and a package-local .env wins over the
// workspace root. Mirrors packages/database/prisma.config.ts, which had to
// solve the same problem: bare `dotenv/config` reads only `<cwd>/.env`, and cwd
// is packages/database when pnpm runs this script. The root path is derived
// from this file rather than from cwd so it holds wherever the script is
// invoked from.
loadEnvFile({ quiet: true });
loadEnvFile({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

// ---------------------------------------------------------------------------
// 1. Safety. A production database must be impossible to nuke by accident.
// ---------------------------------------------------------------------------

/**
 * Hosts a destructive dev seed may touch without an explicit override.
 * Anything else is assumed to be somebody's real database.
 */
const LOCAL_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'host.docker.internal',
  'postgres',
  'saas-starter-postgres',
]);

interface IDatabaseTarget {
  readonly host: string;
  readonly database: string;
}

function parseDatabaseUrl(raw: string | undefined): IDatabaseTarget {
  if (!raw) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a parseable URL.');
  }
  return { host: url.hostname, database: url.pathname.replace(/^\//, '') };
}

/**
 * Refuse to run anywhere that resembles production.
 *
 * Deliberately TWO independent gates. NODE_ENV is a label an operator controls
 * and routinely forgets when running a script by hand; the DATABASE_URL host is
 * what actually decides which rows get deleted. Either one alone has a
 * realistic way to be wrong at exactly the wrong moment.
 *
 * The override is intentionally awkward: two variables, one of which must
 * repeat the target database name back. A single `--force` flag is the kind of
 * thing that ends up in a shell history and then in a runbook.
 */
function assertSafeTarget(target: IDatabaseTarget): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run the dev playground seed with NODE_ENV=production. ' +
        'This script DELETES its own playground rows before rewriting them.',
    );
  }

  if (LOCAL_DB_HOSTS.has(target.host)) return;

  const acknowledged = process.env.SEED_DEV_ALLOW_REMOTE === 'true';
  const confirmed = process.env.SEED_DEV_CONFIRM_DATABASE === target.database;
  if (acknowledged && confirmed) {
    console.warn(
      `[dev.seed] Remote host "${target.host}" allowed by SEED_DEV_ALLOW_REMOTE + ` +
        `SEED_DEV_CONFIRM_DATABASE. Proceeding against database "${target.database}".`,
    );
    return;
  }

  throw new Error(
    `Refusing to seed non-local database host "${target.host}".\n` +
      'This script deletes rows. To target it deliberately, set BOTH:\n' +
      '  SEED_DEV_ALLOW_REMOTE=true\n' +
      `  SEED_DEV_CONFIRM_DATABASE=${target.database}`,
  );
}

// ---------------------------------------------------------------------------
// 2. What gets seeded.
//
// A fixed dataset, not a knob: the playground is small enough to read in full,
// and the same rows on every run make a bug report reproducible by name. The
// only env vars are the two safety overrides, and each of them MUST also appear
// in turbo.json globalEnv or `turbo/no-undeclared-env-vars` fails lint at error
// severity.
// ---------------------------------------------------------------------------

/** Reserved email prefix marking the users this script owns and may delete. */
const PLAYGROUND_EMAIL_PREFIX = 'dev-';

interface IPlaygroundUser {
  /** Local part after the reserved prefix. */
  readonly handle: string;
  /** Null on purpose for one row: the UI falls back to the email. */
  readonly displayName: string | null;
}

/** The two playground users, beside the baseline admin. */
const PLAYGROUND_USERS: readonly IPlaygroundUser[] = [
  { handle: 'jordan.lee', displayName: 'Jordan Lee' },
  { handle: 'taylor.brooks', displayName: null },
];

/**
 * Password for every account this script creates.
 *
 * The same literal the baseline seed uses for its member and e2e fixtures, so
 * one dev password covers every seeded account. Deliberately a literal and not
 * an env var, for the reason spelled out in seed.ts: an env var needs matching
 * entries in .env.example, turbo globalEnv and two CI steps, and breaks
 * silently the moment one of them drifts.
 */
const DEV_PASSWORD = 'P@ssw0rd!Change.Me';

/** Mirrors apps/api/src/modules/auth/services/password.service.ts (Argon2id = 2). */
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Marks the audit rows this script owns, so a re-run removes only those. */
const AUDIT_CORRELATION_PREFIX = 'dev-seed-';

const AUDIT_ROWS = 40;

/** A date `days` from now. Negative is the past. */
function dayOffset(days: number): Date {
  return new Date(Date.now() + days * MS_PER_DAY);
}

function playgroundEmail(handle: string): string {
  return `${PLAYGROUND_EMAIL_PREFIX}${handle}@example.com`;
}

// ---------------------------------------------------------------------------
// 3. The reset.
//
// One transaction, and deliberately NOT a TRUNCATE: TRUNCATE ... CASCADE would
// also take out the e2e fixture users Playwright depends on, in a script whose
// whole purpose is to be run casually and often. Only rows this script owns go:
// users under PLAYGROUND_EMAIL_PREFIX and audit rows under
// AUDIT_CORRELATION_PREFIX.
//
// Why delete-then-rewrite rather than upsert: dates below are relative to now,
// so a re-run re-anchors the audit trail instead of leaving it to age.
// ---------------------------------------------------------------------------

interface IRemoved {
  readonly users: number;
  readonly audits: number;
}

async function resetPlayground(prisma: PrismaClient): Promise<IRemoved> {
  return prisma.$transaction(
    async (tx) => {
      const audits = await tx.auditLog.deleteMany({
        where: { correlationId: { startsWith: AUDIT_CORRELATION_PREFIX } },
      });
      // Their tokens and factors cascade.
      const users = await tx.user.deleteMany({
        where: { email: { startsWith: PLAYGROUND_EMAIL_PREFIX } },
      });
      return { users: users.count, audits: audits.count };
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// 4. Main.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const target = parseDatabaseUrl(process.env.DATABASE_URL);
  assertSafeTarget(target);

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) {
      throw new Error(
        'No ADMIN user. Set ADMIN_EMAIL and ADMIN_PASSWORD, then run ' +
          '`pnpm --filter @repo/database db:seed`.',
      );
    }

    console.log(`[dev.seed] target ${target.database}@${target.host}`);
    console.log('[dev.seed] Resetting...');
    const removed = await resetPlayground(prisma);
    console.log(`[dev.seed]   removed ${removed.users} users, ${removed.audits} audit rows`);

    // One argon2 hash reused across every account: the parameters cost roughly
    // 100 ms a call.
    const passwordHash = await hash(DEV_PASSWORD, ARGON2_OPTIONS);

    const userIds: string[] = [];
    for (const user of PLAYGROUND_USERS) {
      const created = await prisma.user.create({
        data: {
          email: playgroundEmail(user.handle),
          passwordHash,
          displayName: user.displayName,
          role: 'USER',
          emailVerified: true,
        } satisfies Prisma.UserCreateInput,
        select: { id: true },
      });
      userIds.push(created.id);
    }

    // Real action strings from @repo/shared/audit, inlined: packages/database
    // does not depend on @repo/shared. A minority of failures, so any "failures
    // only" view has rows to find.
    const auditActions = [
      'auth.login.success',
      'auth.login.failure',
      'user.role.changed',
      'auth.password.change',
    ] as const;
    const actorIds = [admin.id, ...userIds];
    const auditRows = Array.from({ length: AUDIT_ROWS }, (_row, index) => {
      const action = auditActions[index % auditActions.length] ?? 'auth.login.success';
      const actorId = actorIds[index % actorIds.length] ?? admin.id;
      return {
        userId: actorId,
        action,
        targetType: 'User',
        targetId: actorId,
        ipAddress: `192.168.${index % 4}.${10 + index}`,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Starter/dev-seed',
        correlationId: `${AUDIT_CORRELATION_PREFIX}${index}`,
        success: action !== 'auth.login.failure',
        createdAt: dayOffset(-Math.floor(index / 4)),
      } satisfies Prisma.AuditLogCreateManyInput;
    });
    await prisma.auditLog.createMany({ data: auditRows });

    await verifySeed(prisma, { users: PLAYGROUND_USERS.length, audits: AUDIT_ROWS });
    printSummary(admin.email);
  } finally {
    await prisma.$disconnect();
  }
}

/** Re-read what was written, so a silent write failure is loud here. */
async function verifySeed(
  prisma: PrismaClient,
  expected: { readonly users: number; readonly audits: number },
): Promise<void> {
  const [users, audits] = await Promise.all([
    prisma.user.count({
      where: { email: { startsWith: PLAYGROUND_EMAIL_PREFIX }, deletedAt: null },
    }),
    prisma.auditLog.count({ where: { correlationId: { startsWith: AUDIT_CORRELATION_PREFIX } } }),
  ]);
  const problems: string[] = [];
  if (users !== expected.users) {
    problems.push(`users: wrote ${expected.users}, read back ${users}`);
  }
  if (audits !== expected.audits) {
    problems.push(`audit rows: wrote ${expected.audits}, read back ${audits}`);
  }
  if (problems.length > 0) {
    throw new Error(`Seed verification FAILED:\n  - ${problems.join('\n  - ')}`);
  }
  console.log(`[dev.seed] Verified: ${users} playground users, ${audits} audit rows.`);
}

/** What was created and, more usefully, what to go and click on. */
function printSummary(adminEmail: string): void {
  console.log('');
  console.log('[dev.seed] Done.');
  console.log(`  sign in as         ${adminEmail} / ${DEV_PASSWORD}`);
  console.log(`  playground users   ${PLAYGROUND_EMAIL_PREFIX}*@example.com / ${DEV_PASSWORD}`);
  console.log('');
  console.log('  worth clicking:');
  console.log('    /settings -> Members   user list, roles, two-factor column (ADMIN)');
  console.log('');
}

main().catch((error: unknown) => {
  console.error('[dev.seed] Failed:', error);
  process.exitCode = 1;
});
