/**
 * Shared row factories for the DB-backed security specs.
 *
 * Every finding in this folder is about what the real rows do, so each spec
 * needs the same four things: the unscoped singleton, a `PrismaService` shaped
 * exactly as the app builds it (the tenant-scope extension on top), throwaway
 * tenants and users, and a cleanup that leaves the database as it found it.
 * Writing that four times invites four slightly different versions of it.
 *
 * Kept deliberately small: anything a single finding needs stays in that
 * finding's spec, so a change there cannot quietly move another finding's
 * ground.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import type { PrismaService } from '@/common/database/prisma.service';
import { buildTenantScopeExtension } from '@/common/database/tenant-scope.extension';
import { requirePostgresOrFail } from './harness';

/**
 * A stand-in for an argon2id digest. The literal already carried in
 * `.gitleaks.toml`: any string next to a `passwordHash` key trips the generic
 * API key rule, so the isolation specs settled on this one and these follow.
 */
export const FAKE_HASH = 'argon2-existing';

export interface ISeededUser {
  readonly id: string;
  readonly email: string;
}

export interface ISecurityWorld {
  /** The raw singleton: fixtures are written past the tenant boundary on purpose. */
  readonly unscoped: PrismaClient;
  /** What a service is constructed with: `client` is tenant-scoped, `unscoped` is not. */
  readonly prismaService: PrismaService;
  /** A throwaway organization. `label` only has to make a failing row readable. */
  makeTenant(label: string): Promise<{ id: string }>;
  /** A STAFF member of `tenantId`. Overrides go straight to `user.create`. */
  makeUser(tenantId: string, overrides?: Record<string, unknown>): Promise<ISeededUser>;
  /** Drop a user from the cleanup list, for a case whose assertion IS the delete. */
  forgetUser(id: string): void;
  /** Delete everything this world created, children first. */
  cleanup(): Promise<void>;
}

/**
 * The world this spec file opened, if it got that far.
 *
 * Each spec file gets its own module registry under jest, so this is per-file
 * state, and it is what lets `closeWorld` be safe to register unconditionally:
 * when `openWorld` threw `SPEC-INFRA`, the teardown has nothing to clean and
 * must not add a second, more confusing failure on top of the real one.
 */
let current: ISecurityWorld | undefined;

/**
 * Open a world against the live database, or throw `SPEC-INFRA` trying.
 *
 * `prefix` namespaces every row this spec writes, so a leftover row names the
 * file that leaked it.
 */
export async function openWorld(prefix: string): Promise<ISecurityWorld> {
  const unscoped = await requirePostgresOrFail();
  // Exactly what PrismaService.client hands a service: the extension on the
  // singleton. A spec that read through `unscoped` would prove nothing about
  // the boundary the app actually runs behind.
  const client = unscoped.$extends(buildTenantScopeExtension()) as unknown as PrismaClient;
  const prismaService = { client, unscoped } as unknown as PrismaService;

  const tenantIds = new Set<string>();
  const userIds = new Set<string>();

  const world: ISecurityWorld = {
    unscoped,
    prismaService,

    async makeTenant(label: string) {
      const uid = randomUUID();
      const tenant = await unscoped.tenant.create({
        data: { name: `${prefix}-${label}-${uid}`, slug: `${prefix}-${label}-${uid}` },
        select: { id: true },
      });
      tenantIds.add(tenant.id);
      return tenant;
    },

    async makeUser(tenantId: string, overrides: Record<string, unknown> = {}) {
      const uid = randomUUID();
      const user = await unscoped.user.create({
        data: {
          email: `${prefix}-${uid}@example.test`,
          tenantId,
          role: 'USER',
          passwordHash: FAKE_HASH,
          emailVerified: true,
          ...overrides,
        },
        select: { id: true, email: true },
      });
      userIds.add(user.id);
      return user;
    },

    forgetUser(id: string) {
      userIds.delete(id);
    },

    async cleanup() {
      // Audit rows first (nothing cascades them), then the owner pointer
      // (Tenant.ownerId blocks the user delete), then users (User.tenantId is
      // Restrict, and tokens cascade with them), then tenants.
      if (tenantIds.size > 0) {
        await unscoped.auditLog.deleteMany({ where: { tenantId: { in: [...tenantIds] } } });
        await unscoped.tenant.updateMany({
          where: { id: { in: [...tenantIds] } },
          data: { ownerId: null },
        });
      }
      if (userIds.size > 0) {
        await unscoped.user.deleteMany({ where: { id: { in: [...userIds] } } });
      }
      if (tenantIds.size > 0) {
        await unscoped.tenant.deleteMany({ where: { id: { in: [...tenantIds] } } });
      }
      // Release the pool, or jest holds the worker open after the last case and
      // CI reads a finished suite as a hang.
      await unscoped.$disconnect();
    },
  };

  current = world;
  return world;
}

/** `afterAll(closeWorld)`. A no-op when the world never opened. */
export async function closeWorld(): Promise<void> {
  const world = current;
  current = undefined;
  if (world !== undefined) {
    await world.cleanup();
  }
}
