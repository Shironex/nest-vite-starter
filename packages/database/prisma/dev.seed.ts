/**
 * DEV PLAYGROUND SEED
 *
 * File name: `dev.seed.ts`, not `seed-dev.ts`. The allowlist nestjs.js gives
 * `noctcore-prisma/no-unscoped-prisma-outside-allowlist` carries a double-star glob for
 * any file ending in `.seed.ts`, but pins the other two seeds by literal path.
 * That rule does not reach packages/database today, so this is purely
 * defensive: if seeding logic ever moves under apps/api, or nestjs.js is ever
 * spread into this package, the glob already covers this file.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * `prisma/seed.ts` is the BASELINE seed: the default organization, one
 * baseline Workspace, the admin, the member, the e2e fixture accounts. It is a
 * bootstrap, not a dataset.
 *
 * This script fills the SAME tenant with a small, fixed playground: a few staff
 * members of each role, two more workspaces and an
 * audit trail, so the platform screens have something to render without a human
 * creating rows by hand. It also seeds a SECOND, deliberately tiny organization so
 * tenant isolation is eyeballable by hand rather than only assertable in a test.
 *
 * It re-creates nothing that `seed.ts` owns. Run order:
 *
 *   pnpm --filter @repo/database db:seed        # baseline (admin, workspace, e2e)
 *   pnpm --filter @repo/database db:seed:dev    # this file
 *
 * `db:seed:dev` chains both, so `pnpm db:seed:dev` from the repo root is enough.
 *
 * Add your product's own playground rows here, next to the platform ones, and
 * extend `resetTenantData` and `verifySeed` for every table you add.
 *
 * ---------------------------------------------------------------------------
 * THE TENANCY CONTRACT: read before changing any write below
 * ---------------------------------------------------------------------------
 * The app's only isolation boundary is the Prisma `$extends` tenant-scope
 * extension in `apps/api/src/common/database/tenant-scope.extension.ts`,
 * applied by `PrismaService.onModuleInit`. It lives in apps/api. It is not part
 * of `@repo/database`, and it is not part of the generated client. There is no
 * Postgres RLS behind it.
 *
 * This script therefore never loads it, and nothing injects `tenantId` /
 * `workspaceId` here. Every row written below must carry them EXPLICITLY and
 * CORRECTLY, because the app reads them back through the scoped client with
 * `WHERE tenantId = ...` merged in. A row written with a wrong or absent
 * tenantId is not a crash. It is an invisible row that the UI can never show
 * and no test will notice. `verifySeed()` re-reads every table with an explicit
 * `where: { tenantId }` and asserts the counts match what was written, for BOTH
 * tenants, and that neither tenant can see the other's Workspaces.
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
        "This script DELETES the target tenants' playground data before rewriting it.",
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

/**
 * The tenant to fill: the organization `seed.ts` creates and the seeded admin belongs
 * to. A constant rather than a knob because the admin's tenant is the only one
 * the seeded admin can see, so pointing this elsewhere produces data nobody can
 * log in and look at.
 */
const TENANT_SLUG = 'default-organization';

/**
 * The Workspace `seed.ts` creates. Preserved across resets: this script does not
 * own it, and the e2e suite may select it by name.
 */
const BASELINE_WORKSPACE_NAME = 'Example Workspace';

/** Reserved email prefix marking the users this script owns and may delete. */
const STAFF_EMAIL_PREFIX = 'dev-';

type StaffRole = 'ADMIN' | 'USER';

interface IStaffSeed {
  /** Local part after the reserved prefix. */
  readonly handle: string;
  /** Null on purpose for some rows: the UI falls back to the email. */
  readonly displayName: string | null;
  readonly role: StaffRole;
}

/**
 * The primary organization's extra staff, beyond the baseline admin and member. More
 * than one of each role, so the members list shows both roles and the
 * last-admin guard has other admins to count.
 */
const PRIMARY_STAFF: readonly IStaffSeed[] = [
  { handle: 'alex.morgan', displayName: 'Alex Morgan', role: 'ADMIN' },
  { handle: 'sam.rivera', displayName: 'Sam Rivera', role: 'ADMIN' },
  { handle: 'jordan.lee', displayName: 'Jordan Lee', role: 'USER' },
  { handle: 'taylor.brooks', displayName: null, role: 'USER' },
  { handle: 'casey.nguyen', displayName: 'Casey Nguyen', role: 'USER' },
];

/** The primary organization's playground workspaces, beside the baseline one. */
const PRIMARY_WORKSPACES: readonly { readonly name: string }[] = [
  { name: 'Northwind Trading Ltd' },
  { name: 'Contoso Logistics Ltd' },
];

/**
 * A SECOND organization, deliberately tiny.
 *
 * Isolation in this product rests solely on the Prisma `$extends` extension:
 * there is no RLS backstop, and a mis-stamped `tenantId` is a silent bug, not an
 * error. One tenant on its own cannot show that: an empty screen looks the same
 * whether isolation works or whether the seed wrote nothing. Two tenants make it
 * a five-second manual check: sign in here, see exactly these people and these
 * workspaces, and none of the other organization's.
 */
const SECOND_TENANT = {
  slug: 'control-organization',
  name: 'Control Organization',
  staff: [
    { handle: 'control.admin', displayName: 'Control Organization (admin)', role: 'ADMIN' },
    { handle: 'control.user', displayName: 'Control Organization (user)', role: 'USER' },
  ],
  workspaces: [{ name: 'Fabrikam Services Ltd' }, { name: 'Tailspin Audit Ltd' }],
} as const satisfies {
  slug: string;
  name: string;
  staff: readonly IStaffSeed[];
  workspaces: readonly { name: string }[];
};

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

/** A date `days` from now. Negative is the past. */
function dayOffset(days: number): Date {
  return new Date(Date.now() + days * MS_PER_DAY);
}

function staffEmail(handle: string): string {
  return `${STAFF_EMAIL_PREFIX}${handle}@example.com`;
}

// ---------------------------------------------------------------------------
// 3. The reset.
//
// Scoped to one tenant at a time, in foreign-key order, inside ONE transaction,
// and run for BOTH tenants before anything is written. Deliberately NOT a
// TRUNCATE: TRUNCATE ... CASCADE would also take out the e2e fixture users Playwright depends on, in a script whose whole
// purpose is to be run casually and often.
//
// What survives on purpose: the Tenant rows, the baseline admin / member / e2e
// fixture users, and the baseline Workspace. Only rows this script owns go: users
// under STAFF_EMAIL_PREFIX, every Workspace not preserved, and the tenant's
// audit rows.
//
// Why delete-then-rewrite rather than upsert: dates below are relative to now,
// so a re-run re-anchors the audit trail instead of leaving them to
// age.
// ---------------------------------------------------------------------------

interface IRemoved {
  readonly workspaces: number;
  readonly staff: number;
  readonly audits: number;
}

async function resetTenantData(
  prisma: PrismaClient,
  tenantId: string,
  /** Workspace names to keep (the baseline workspace); empty removes them all. */
  preserveWorkspaceNames: readonly string[],
): Promise<IRemoved> {
  return prisma.$transaction(
    async (tx) => {
      const audits = await tx.auditLog.deleteMany({ where: { tenantId } });

      const workspaces = await tx.workspace.deleteMany({
        where:
          preserveWorkspaceNames.length === 0
            ? { tenantId }
            : { tenantId, name: { notIn: [...preserveWorkspaceNames] } },
      });

      // Only the staff users this script created, identified by the reserved
      // email prefix. The baseline admin, the member and the e2e fixtures never
      // match. Their tokens and factors cascade; their audit rows
      // (already gone above) and a Tenant.ownerId pointing at them SetNull.
      const staff = await tx.user.deleteMany({
        where: { tenantId, email: { startsWith: STAFF_EMAIL_PREFIX } },
      });

      return {
        workspaces: workspaces.count,
        staff: staff.count,
        audits: audits.count,
      };
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

function logRemoved(label: string, removed: IRemoved): void {
  console.log(
    `[dev.seed]   ${label}: removed ${removed.workspaces} workspaces, ${removed.staff} staff users, ` +
      `${removed.audits} audit rows`,
  );
}

// ---------------------------------------------------------------------------
// 4. Writers.
// ---------------------------------------------------------------------------

/**
 * Upsert rather than create: User.email is globally unique, so a row left in
 * another tenant by an older run would otherwise fail the whole seed on P2002.
 * Every field the seed owns is stated on update too, so a re-run takes a
 * drifted row all the way back.
 */
async function upsertStaff(
  prisma: PrismaClient,
  tenantId: string,
  staff: readonly IStaffSeed[],
  passwordHash: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (const member of staff) {
    const fields = {
      passwordHash,
      displayName: member.displayName,
      role: member.role,
      emailVerified: true,
      tenantId,
      failedAttempts: 0,
      lockoutCount: 0,
      lockedUntil: null,
      deletedAt: null,
      membershipEndedAt: null,
    } as const satisfies Prisma.UserUncheckedUpdateInput;
    const email = staffEmail(member.handle);
    const user = await prisma.user.upsert({
      where: { email },
      update: fields,
      create: { email, ...fields },
      select: { id: true },
    });
    ids.push(user.id);
  }
  return ids;
}

async function createWorkspaces(
  prisma: PrismaClient,
  tenantId: string,
  workspaces: readonly { readonly name: string }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const workspace of workspaces) {
    const row = await prisma.workspace.create({
      data: { tenantId, name: workspace.name, legalName: workspace.name },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 5. Main.
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
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) {
      throw new Error(
        `No tenant with slug "${TENANT_SLUG}". Run the baseline seed first:\n` +
          '  pnpm --filter @repo/database db:seed',
      );
    }
    const admin = await prisma.user.findFirst({
      where: { tenantId: tenant.id, role: 'ADMIN', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) {
      throw new Error(
        `Tenant "${TENANT_SLUG}" has no ADMIN user. Set ADMIN_EMAIL and ADMIN_PASSWORD, then ` +
          'run `pnpm --filter @repo/database db:seed`.',
      );
    }
    const tenantId = tenant.id;

    console.log(`[dev.seed] target ${target.database}@${target.host} | tenant "${TENANT_SLUG}"`);

    // BOTH resets run before ANY insert, so a staff email or a Workspace left in the
    // other tenant by an older run is gone before either tenant is written.
    const secondTenant = await prisma.tenant.upsert({
      where: { slug: SECOND_TENANT.slug },
      update: {},
      create: { name: SECOND_TENANT.name, slug: SECOND_TENANT.slug },
    });
    console.log('[dev.seed] Resetting...');
    logRemoved(TENANT_SLUG, await resetTenantData(prisma, tenantId, [BASELINE_WORKSPACE_NAME]));
    logRemoved(SECOND_TENANT.slug, await resetTenantData(prisma, secondTenant.id, []));

    // One argon2 hash reused across every account: the parameters cost roughly
    // 100 ms a call.
    const passwordHash = await hash(DEV_PASSWORD, ARGON2_OPTIONS);

    // --- primary organization -----------------------------------------------------
    const staffIds = await upsertStaff(prisma, tenantId, PRIMARY_STAFF, passwordHash);
    const newWorkspaceIds = await createWorkspaces(prisma, tenantId, PRIMARY_WORKSPACES);
    const baselineWorkspace = await prisma.workspace.findFirst({
      where: { tenantId, name: BASELINE_WORKSPACE_NAME },
      select: { id: true },
    });
    const workspaceIds = [...(baselineWorkspace ? [baselineWorkspace.id] : []), ...newWorkspaceIds];

    // --- audit log ---------------------------------------------------------
    // Real action strings from @repo/shared/audit, inlined: packages/database
    // does not depend on @repo/shared. A minority of failures, so any "failures
    // only" view has rows to find.
    const auditActions = [
      'auth.login.success',
      'auth.login.failure',
      'user.role.changed',
      'auth.password.change',
    ] as const;
    const actorIds = [admin.id, ...staffIds];
    const AUDIT_ROWS = 40;
    const auditRows = Array.from({ length: AUDIT_ROWS }, (_row, index) => {
      const action = auditActions[index % auditActions.length] ?? 'auth.login.success';
      const actorId = actorIds[index % actorIds.length] ?? admin.id;
      return {
        userId: actorId,
        tenantId,
        workspaceId: null,
        action,
        targetType: 'User',
        targetId: actorId,
        ipAddress: `192.168.${index % 4}.${10 + index}`,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SaaSStarter/dev-seed',
        correlationId: `dev-seed-${index}`,
        success: action !== 'auth.login.failure',
        createdAt: dayOffset(-Math.floor(index / 4)),
      };
    });
    await prisma.auditLog.createMany({ data: auditRows });

    // --- second organization ------------------------------------------------------
    const secondStaffIds = await upsertStaff(
      prisma,
      secondTenant.id,
      SECOND_TENANT.staff,
      passwordHash,
    );
    const secondWorkspaceIds = await createWorkspaces(
      prisma,
      secondTenant.id,
      SECOND_TENANT.workspaces,
    );

    await verifySeed(prisma, [
      {
        label: TENANT_SLUG,
        tenantId,
        workspaces: workspaceIds.length,
        staff: PRIMARY_STAFF.length,
        audits: AUDIT_ROWS,
        foreignWorkspaceIds: secondWorkspaceIds,
      },
      {
        label: SECOND_TENANT.slug,
        tenantId: secondTenant.id,
        workspaces: secondWorkspaceIds.length,
        staff: SECOND_TENANT.staff.length,
        audits: 0,
        foreignWorkspaceIds: workspaceIds,
      },
    ]);

    printSummary({
      tenantId,
      adminEmail: admin.email,
      staffCount: staffIds.length,
      workspaceCount: workspaceIds.length,
      secondTenantId: secondTenant.id,
      secondStaffCount: secondStaffIds.length,
      secondWorkspaceCount: secondWorkspaceIds.length,
    });
  } finally {
    await prisma.$disconnect();
  }
}

interface ITenantExpectation {
  readonly label: string;
  readonly tenantId: string;
  readonly workspaces: number;
  readonly staff: number;
  readonly audits: number;
  /** Workspace ids belonging to the OTHER tenant. None of them may be reachable. */
  readonly foreignWorkspaceIds: readonly string[];
}

/**
 * Prove the rows are readable the way the APP reads them, and only by the tenant
 * that owns them.
 *
 * Every count below re-filters by the explicit `tenantId` the tenant-scope
 * extension would have injected, so a mismatch means a row carries a scope the
 * application can never match: an invisible row. The cross-tenant check is the
 * other direction, and it matters because the `$extends` extension is the only
 * isolation boundary in this system; there is no RLS to catch a leak behind
 * it.
 */
async function verifySeed(
  prisma: PrismaClient,
  expectations: readonly ITenantExpectation[],
): Promise<void> {
  const problems: string[] = [];

  for (const expected of expectations) {
    const { tenantId, label } = expected;
    const [workspaces, staff, audits, foreignWorkspaces] = await Promise.all([
      prisma.workspace.count({ where: { tenantId } }),
      prisma.user.count({ where: { tenantId, email: { startsWith: STAFF_EMAIL_PREFIX } } }),
      prisma.auditLog.count({ where: { tenantId } }),
      expected.foreignWorkspaceIds.length > 0
        ? prisma.workspace.count({
            where: { tenantId, id: { in: [...expected.foreignWorkspaceIds] } },
          })
        : Promise.resolve(0),
    ]);

    if (workspaces !== expected.workspaces) {
      problems.push(
        `${label} workspaces: expected ${expected.workspaces}, tenant-scoped read sees ${workspaces}`,
      );
    }
    if (staff !== expected.staff) {
      problems.push(`${label} staff: wrote ${expected.staff}, tenant-scoped read sees ${staff}`);
    }
    if (audits !== expected.audits) {
      problems.push(
        `${label} audit rows: wrote ${expected.audits}, tenant-scoped read sees ${audits}`,
      );
    }
    if (foreignWorkspaces > 0) {
      problems.push(`${label}: ${foreignWorkspaces} Workspaces are visible from the WRONG tenant`);
    }

    if (problems.length === 0) {
      console.log(
        `[dev.seed] Verified "${label}" through a tenant-scoped read: ${workspaces} workspaces, ` +
          `${staff} dev staff, ${audits} audit rows, ` +
          'no cross-tenant rows.',
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`Seed verification FAILED:\n  - ${problems.join('\n  - ')}`);
  }
}

interface ISummaryInput {
  readonly tenantId: string;
  readonly adminEmail: string;
  readonly staffCount: number;
  readonly workspaceCount: number;
  readonly secondTenantId: string;
  readonly secondStaffCount: number;
  readonly secondWorkspaceCount: number;
}

/** What was created and, more usefully, what to go and click on. */
function printSummary(input: ISummaryInput): void {
  console.log('');
  console.log('[dev.seed] Done.');
  console.log(`  tenant             ${TENANT_SLUG} (${input.tenantId})`);
  console.log(`  sign in as         ${input.adminEmail} / ${DEV_PASSWORD}`);
  console.log(`  extra staff        ${STAFF_EMAIL_PREFIX}*@example.com / ${DEV_PASSWORD}`);
  console.log('');
  console.log(`  workspaces              ${input.workspaceCount}`);
  console.log(`  staff users        ${input.staffCount} (plus the baseline admin and member)`);
  console.log('');
  console.log(`  second organization       ${SECOND_TENANT.slug} (${input.secondTenantId})`);
  console.log(
    `    sign in as       ${staffEmail(SECOND_TENANT.staff[0].handle)} / ${DEV_PASSWORD}`,
  );
  console.log(
    `    holds            ${input.secondStaffCount} staff across ${input.secondWorkspaceCount} ` +
      'workspaces, and must see NONE of the above',
  );
  console.log('');
  console.log('  worth clicking:');
  console.log('    /settings -> Members   staff list, roles, two-factor column (ADMIN)');
  console.log('    both admins in turn    the tenant boundary, checked by eye');
  console.log('');
}

main().catch((error: unknown) => {
  console.error('[dev.seed] Failed:', error);
  process.exitCode = 1;
});
