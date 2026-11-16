import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';

// Nearest first, and dotenv never overwrites an already-set key: the real
// process environment (a CI step env, an exported shell var, turbo's globalEnv
// passthrough) wins over both files, and a package-local .env wins over the
// workspace root. Mirrors packages/database/prisma.config.ts and
// packages/database/prisma/dev.seed.ts, which had to solve the same problem:
// bare `dotenv/config` reads only `<cwd>/.env`, and cwd is packages/database
// when pnpm runs this script, a file that carries DATABASE_URL and nothing
// else, while ADMIN_EMAIL / ADMIN_PASSWORD live in the workspace-root .env.
// Reading only the package file is what made the admin block below skip itself
// silently on a checkout that had the credentials all along. The root path is
// derived from this file rather than from cwd so it holds wherever the script is
// invoked from.
loadEnvFile({ quiet: true });
loadEnvFile({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
  console.error(
    'Refusing to run seed against NODE_ENV=production. The seed script creates a known admin user with credentials from ADMIN_EMAIL / ADMIN_PASSWORD. Set ALLOW_PRODUCTION_SEED=true if this is intentional (e.g. first-time bootstrap of a fresh production DB).',
  );
  process.exit(1);
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});

const prisma = new PrismaClient({ adapter });

const STARTER_PERMISSIONS = [
  { name: 'manage_users', description: 'Create, update, and delete user accounts' },
  { name: 'manage_roles', description: 'Assign and modify user roles and permissions' },
  { name: 'view_admin_panel', description: 'Access the administration dashboard' },
  { name: 'manage_settings', description: 'Modify application settings' },
  { name: 'view_audit_log', description: 'View the audit log of admin actions' },
] as const;

/**
 * Password shared by every dev/e2e fixture user below. Same value as the
 * ADMIN_PASSWORD / MEMBER_PASSWORD defaults, hashed the same way.
 *
 * Deliberately a literal rather than an env var: unlike ADMIN_*, these accounts
 * are never a deployment's bootstrap credential: they exist only under
 * NODE_ENV !== 'production' and only so the Playwright suite has accounts it
 * can hold exclusively. An env var would need a matching entry in .env.example,
 * turbo.json globalEnv, and both CI steps, and would still break the specs the
 * moment one of those drifted. A literal breaks loudly and immediately instead.
 *
 * MUST match E2E_FIXTURE_PASSWORD in apps/web/e2e/support/auth.ts.
 */
const E2E_FIXTURE_PASSWORD = 'P@ssw0rd!Change.Me';

/**
 * The one dev/e2e account that has never answered a guided tour.
 *
 * Every other fixture is seeded as having seen all of them (see
 * `E2E_ANSWERED_TOURS`), which is what makes the Playwright suite
 * deterministic. Seeding them all would be an easy way to turn the feature off
 * in tests without anybody noticing it had stopped working in the product, so
 * one account is deliberately held back and `help-tour.spec.ts` signs in as it
 * to prove a tour still starts on its own.
 *
 * MUST match TOUR_FIXTURE_EMAIL in apps/web/e2e/support/auth.ts.
 */
const E2E_TOUR_FIXTURE_EMAIL = 'e2e-tour@example.com';

/**
 * Every guided tour the web app registers, by id.
 *
 * The seed writes an answered entry for each one against every dev/e2e account
 * except `E2E_TOUR_FIXTURE_EMAIL`, because a tour auto-starts for anybody who
 * has never answered and CI runs against a database where nobody has. A live
 * driver.js overlay masks everything outside its spotlight, so a spec's click
 * lands on the mask and retries until it times out, red on CI while passing on
 * a local database whose admin had already answered.
 *
 * "A user who has seen the tours" is an ordinary state, not a test-only
 * pretense, so this leaves the feature fully live for real users and for the
 * fixture held back above.
 *
 * MUST match TOURS in apps/web/src/features/help/Help.tours.ts. The client
 * decides on the tour ID alone, so an id added there and not here silently
 * re-arms an auto-start in CI; `Help.seed.test.ts` fails when the two drift.
 */
const E2E_ANSWERED_TOURS = ['dashboard'] as const;

/**
 * One dedicated account per e2e spec family, so no two Playwright spec files
 * contend for the same user's state.
 *
 * Playwright runs spec FILES concurrently at default local parallelism, and
 * `test.describe.serial` only serializes within a file. The two-factor journeys
 * hold their account in an enrolled-2FA state for minutes at a time, which
 * bounces any other spec sharing that account to /auth/two-factor; they also
 * each burn two of the 5-per-300s per-user 2FA manage operations, which trips
 * the limiter partway through a whole-file run.
 *
 * The three two-factor accounts are one per journey so those windows never
 * overlap. All of them are USER role: the journeys enroll themselves from the
 * settings Security tab, which needs no admin rights, and the one journey that
 * does need ADMIN acts as the seeded admin instead.
 *
 * No displayName on any of them, matching the admin and member fixtures: the
 * dashboard greeting renders `displayName ?? email` (DashboardPage.hooks.ts),
 * and auth-login.spec.ts asserts that greeting carries the address it signed in
 * with.
 *
 * MUST match the fixture list in apps/web/e2e/support/auth.ts.
 */
const E2E_FIXTURE_USERS = [
  // auth-login.spec.ts. Owns the deliberate wrong-password submit, so the
  // failed-attempt counter it drives toward MAX_FAILED_ATTEMPTS can never lock
  // out the admin every other spec logs in as.
  'e2e-login@example.com',
  // two-factor.spec.ts, one per journey in the serial group.
  'e2e-2fa-totp@example.com',
  'e2e-2fa-recovery@example.com',
  'e2e-2fa-trust@example.com',
  // help-tour.spec.ts. Held back from the answered-tours write below, and
  // nothing else touches it, so its tour state is its own.
  E2E_TOUR_FIXTURE_EMAIL,
] as const;

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  // Hoisted because the dev/e2e block below needs the same address the admin
  // row was written under, and it runs whether or not admin credentials were
  // supplied.
  const normalizedAdminEmail = adminEmail?.trim().toLowerCase() ?? null;

  // Create starter permissions
  console.log('Creating starter permissions...');
  const permissions = await Promise.all(
    STARTER_PERMISSIONS.map((perm) =>
      prisma.permission.upsert({
        where: { name: perm.name },
        update: { description: perm.description },
        create: perm,
      }),
    ),
  );
  console.log(`Created/updated ${permissions.length} permissions`);

  // Create the default Tenant (an organization) so the seeded admin has a tenant.
  // Registration will create an organization per signup later; for now the admin is
  // attached to this default one. Idempotent on the unique slug.
  console.log('Creating default tenant (organization)...');
  const defaultTenant = await prisma.tenant.upsert({
    where: { slug: 'default-organization' },
    update: {},
    create: { name: 'Default Organization', slug: 'default-organization' },
  });
  console.log(`Default tenant ready: ${defaultTenant.slug}`);

  // Create a default Workspace under that organization, so the second
  // tenancy tier is populated on a freshly seeded database and every
  // Workspace-scoped flow has a workspace to act on. Idempotent on the
  // @@unique([tenantId, name]).
  console.log('Creating default workspace...');
  const defaultWorkspace = await prisma.workspace.upsert({
    where: { tenantId_name: { tenantId: defaultTenant.id, name: 'Example Workspace' } },
    update: {},
    create: { tenantId: defaultTenant.id, name: 'Example Workspace' },
  });
  console.log(`Default workspace ready: ${defaultWorkspace.name}`);

  // Create admin user if credentials provided
  if (adminEmail && adminPassword) {
    console.log('Creating admin user...');
    // Algorithm.Argon2id = 2 (const enum cannot be imported with verbatimModuleSyntax)
    const passwordHash = await hash(adminPassword, {
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const normalizedEmail = adminEmail.trim().toLowerCase();

    const admin = await prisma.user.upsert({
      where: { email: normalizedEmail },
      update: {
        passwordHash,
        role: 'ADMIN',
        emailVerified: true,
        tenantId: defaultTenant.id,
        // Reset lockout state on re-seed so a prior run that locked the admin
        // (e.g. failed logins from a misconfigured load test) hands back a
        // login-able account instead of staying ACCOUNT_LOCKED.
        failedAttempts: 0,
        lockoutCount: 0,
        lockedUntil: null,
      },
      create: {
        email: normalizedEmail,
        passwordHash,
        role: 'ADMIN',
        emailVerified: true,
        tenantId: defaultTenant.id,
      },
    });
    console.log(`Admin user created/updated: ${admin.email}`);

    // Assign all permissions to ADMIN role (role-wide, userId: null).
    // Uniqueness is enforced by the partial index
    // RolePermission_role_permission_global_key (role, permissionId WHERE
    // userId IS NULL), so create directly and treat a unique violation as
    // "already granted". A findFirst-then-create check would race with a
    // concurrent seed; the index makes the create itself the gate.
    console.log('Assigning permissions to ADMIN role...');
    for (const permission of permissions) {
      try {
        await prisma.rolePermission.create({
          data: {
            role: 'ADMIN',
            permissionId: permission.id,
            userId: null,
          },
        });
      } catch (error) {
        const isUniqueViolation =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isUniqueViolation) {
          throw error;
        }
      }
    }
    console.log('Admin role permissions assigned');
  } else {
    console.log('Skipping admin user creation (ADMIN_EMAIL and ADMIN_PASSWORD not set)');
  }

  // Dev/e2e fixture: a second member in the admin's tenant with 2FA enabled, so
  // the admin members UI (and its "reset two-factor" e2e) has a real member to act on.
  // Never seeded in production. A placeholder TOTP secret is enough because the
  // reset flow only deletes the factor row; it is never decrypted for this user
  // (nothing logs in as the member in the e2e).
  if (process.env.NODE_ENV !== 'production') {
    const memberEmail = (process.env.MEMBER_EMAIL ?? 'member@example.com').trim().toLowerCase();
    const memberPassword = process.env.MEMBER_PASSWORD ?? 'P@ssw0rd!Change.Me';
    console.log('Creating member user (dev/e2e fixture)...');
    const memberPasswordHash = await hash(memberPassword, {
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const member = await prisma.user.upsert({
      where: { email: memberEmail },
      update: {
        passwordHash: memberPasswordHash,
        role: 'USER',
        emailVerified: true,
        tenantId: defaultTenant.id,
        failedAttempts: 0,
        lockoutCount: 0,
        lockedUntil: null,
      },
      create: {
        email: memberEmail,
        passwordHash: memberPasswordHash,
        role: 'USER',
        emailVerified: true,
        tenantId: defaultTenant.id,
      },
    });

    // Give the member exactly one ACTIVE TOTP factor so they show as "2FA on".
    // Replace-all keeps the seed idempotent under the partial unique index (one
    // ACTIVE TOTP per user) across re-runs and after the reset e2e wipes it.
    await prisma.secondFactor.deleteMany({ where: { userId: member.id } });
    await prisma.secondFactor.create({
      data: {
        userId: member.id,
        type: 'TOTP',
        status: 'ACTIVE',
        totpSecretEnc: 'seed-placeholder-totp-secret',
        activatedAt: new Date(),
      },
    });
    console.log(`Member user ready (2FA enabled): ${member.email}`);

    // One account per e2e spec family (see E2E_FIXTURE_USERS above). Hashed
    // once: argon2id at these parameters costs ~100 ms a call, and every
    // fixture shares the same password.
    console.log('Creating e2e fixture users...');
    const fixturePasswordHash = await hash(E2E_FIXTURE_PASSWORD, {
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    for (const fixtureEmail of E2E_FIXTURE_USERS) {
      const fixtureUser = await prisma.user.upsert({
        where: { email: fixtureEmail },
        update: {
          passwordHash: fixturePasswordHash,
          // Explicit, not omitted: the seed owns these rows outright, so a
          // re-seed has to be able to take a field BACK to its fixture value.
          // Omitting it preserves whatever a previous seed or a test wrote, and
          // a lingering displayName silently changes the dashboard greeting
          // auth-login.spec.ts asserts on.
          displayName: null,
          role: 'USER',
          emailVerified: true,
          tenantId: defaultTenant.id,
          failedAttempts: 0,
          lockoutCount: 0,
          lockedUntil: null,
        },
        create: {
          email: fixtureEmail,
          passwordHash: fixturePasswordHash,
          role: 'USER',
          emailVerified: true,
          tenantId: defaultTenant.id,
        },
      });

      // Hand back a 2FA-free account. The two-factor journeys enroll their own
      // fixture and leave it enrolled; the spec's first test resets them all
      // through the admin members tab, but a run killed mid-journey cannot, so
      // a re-seed is the other way back to a clean fixture.
      await prisma.secondFactor.deleteMany({ where: { userId: fixtureUser.id } });
    }
    console.log(`E2E fixture users ready: ${E2E_FIXTURE_USERS.length}`);

    /*
     * Every dev/e2e account has already answered every guided tour, except the
     * one account that exists to prove they still run (E2E_TOUR_FIXTURE_EMAIL).
     *
     * WHY THIS IS SEEDED AND NOT SWITCHED OFF. A tour auto-starts for a user
     * who has never answered, driver.js masks everything outside its spotlight
     * while it is up, and CI runs against a database where nobody has answered
     * anything. So a spec's click lands on the mask and retries until it times
     * out, on whichever screen happens to have a tour, while the same spec
     * passes locally against a database whose admin answered days ago. A flag
     * that disabled tours under test would fix the flake and take the feature
     * out of the suite with it; seeding the answer leaves the product code
     * identical in CI and in production, and "somebody who has seen the tours"
     * is the state most real users are in anyway.
     *
     * `dismissed: false` and `version: 1`: the client's auto-start decision
     * reads only whether an entry EXISTS (TourLauncher.hooks.ts), so neither
     * field changes behavior here. They are the honest values for "walked to
     * the end of version 1" rather than placeholders.
     */
    const answeredAt = new Date().toISOString();
    const answeredTours = Object.fromEntries(
      E2E_ANSWERED_TOURS.map((tourId) => [
        tourId,
        { completedAt: answeredAt, version: 1, dismissed: false },
      ]),
    );
    const answeredEmails = [normalizedAdminEmail, memberEmail, ...E2E_FIXTURE_USERS].filter(
      (email): email is string => email !== null && email !== E2E_TOUR_FIXTURE_EMAIL,
    );

    const answeredUsers = await prisma.user.findMany({
      where: { email: { in: answeredEmails } },
      select: { id: true },
    });
    for (const { id } of answeredUsers) {
      await prisma.tourProgress.upsert({
        where: { userId: id },
        update: { tours: answeredTours },
        create: { userId: id, tours: answeredTours },
      });
    }

    // Explicitly cleared, not merely skipped: a previous run of the spec that
    // proves auto-start leaves this account having answered, and a re-seed has
    // to be able to take that back.
    await prisma.tourProgress.deleteMany({
      where: { user: { email: E2E_TOUR_FIXTURE_EMAIL } },
    });
    console.log(
      `Tour progress seeded: ${answeredUsers.length} answered, ${E2E_TOUR_FIXTURE_EMAIL} left unanswered`,
    );
  }

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
