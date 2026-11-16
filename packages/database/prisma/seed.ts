import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client.js';
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
] as const;

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

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
