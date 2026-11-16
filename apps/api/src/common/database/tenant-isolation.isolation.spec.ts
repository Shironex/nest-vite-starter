/**
 * Tenant-isolation proof. Runs against the LIVE docker Postgres (no RLS), so it
 * is excluded from the fast jest lane and only runs via the integration config
 * (`pnpm --filter @repo/api test:integration`). Requires a real DATABASE_URL;
 * export the repo `.env` before running:
 *
 *   set -a && . ./.env && set +a && pnpm --filter @repo/api test:integration
 *
 * Each test asserts one clause of the tenant-scope extension's behavioral
 * contract. The extension is the ONLY isolation boundary (there is no Postgres
 * RLS), so T7 deliberately demonstrates the unscoped leak to prove that point.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { esmImport } from '../utils/esm-import';
import { requestContext } from '../context/request-context';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';

// `@repo/database` is ESM-only and Prisma 7 lazy-loads a WASM query compiler via
// native `import()`. Static-importing it under jest drags Prisma's runtime
// through jest's CJS transform and the WASM loader fails to parse. So load it
// the same way the app does - via `esmImport` (a real native dynamic import) -
// in beforeAll. `request-context` is still the shared CJS instance, so the ALS
// set here is the same one the extension reads.
let unscoped: PrismaClient;
let client: PrismaClient;

// Created-row ids tracked for teardown so a mid-suite failure still cleans up.
const createdWorkspaceIds = new Set<string>();
const createdTenantIds = new Set<string>();

let tenantA: { id: string };
let tenantB: { id: string };
let workspaceA: { id: string; name: string };
let workspaceB: { id: string; name: string };

const run = (tenantId: string | undefined, fn: () => Promise<void>): Promise<void> =>
  requestContext.run({ requestId: 'iso-test', tenantId }, fn);

beforeAll(async () => {
  // Native dynamic import: keeps Prisma's ESM runtime out of jest's CJS path.
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  // `unscoped` is the raw singleton (slow-query extension only): used for setup,
  // teardown, and read-backs so those paths never hit the fail-closed guard.
  unscoped = prisma;
  // `client` is the tenant-scoped extended client, exactly as
  // PrismaService.client builds it, unless the isolation canary
  // (`pnpm canary:isolation`) asked for a mutant registry, which is how
  // this lane proves it goes red when the boundary breaks.
  client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;

  const uid = randomUUID();
  // Setup uses the UNSCOPED client with no ALS: tenants/workspaces are created
  // directly so the fixtures themselves are not subject to the boundary.
  tenantA = await unscoped.tenant.create({
    data: { name: `iso-tenant-a-${uid}`, slug: `iso-a-${uid}` },
  });
  tenantB = await unscoped.tenant.create({
    data: { name: `iso-tenant-b-${uid}`, slug: `iso-b-${uid}` },
  });
  createdTenantIds.add(tenantA.id);
  createdTenantIds.add(tenantB.id);

  workspaceA = await unscoped.workspace.create({
    data: { name: `iso-workspace-a-${uid}`, tenantId: tenantA.id },
  });
  workspaceB = await unscoped.workspace.create({
    data: { name: `iso-workspace-b-${uid}`, tenantId: tenantB.id },
  });
  createdWorkspaceIds.add(workspaceA.id);
  createdWorkspaceIds.add(workspaceB.id);
});

afterAll(async () => {
  // Teardown via the UNSCOPED client (no ALS) so it can reach both tenants'
  // rows regardless of which test failed. Workspaces first (FK), then tenants.
  if (createdWorkspaceIds.size > 0) {
    await unscoped.workspace.deleteMany({ where: { id: { in: [...createdWorkspaceIds] } } });
  }
  if (createdTenantIds.size > 0) {
    await unscoped.tenant.deleteMany({ where: { id: { in: [...createdTenantIds] } } });
  }
  await unscoped?.$disconnect();
});

describe('tenant isolation (live DB, app-layer extension is the only boundary)', () => {
  it('T1 scoped read isolation: findMany returns only the active tenant rows', async () => {
    await run(tenantB.id, async () => {
      const rows = await client.workspace.findMany();
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(workspaceB.id);
      expect(ids).not.toContain(workspaceA.id);
      // Every visible row belongs to tenant B.
      expect(rows.every((r) => r.tenantId === tenantB.id)).toBe(true);
    });
  });

  it('T2 scoped findUnique by cross-tenant id resolves to null', async () => {
    await run(tenantB.id, async () => {
      const row = await client.workspace.findUnique({ where: { id: workspaceA.id } });
      expect(row).toBeNull();
    });
  });

  it('T3 scoped findFirst by cross-tenant id resolves to null', async () => {
    await run(tenantB.id, async () => {
      const row = await client.workspace.findFirst({ where: { id: workspaceA.id } });
      expect(row).toBeNull();
    });
  });

  it('T4 cross-tenant update by id matches no row and throws (other tenant unchanged)', async () => {
    await run(tenantB.id, async () => {
      // Attempt to rename tenant A's workspace while scoped to tenant B. The scope
      // key is merged into the where-unique, so the row is not found and Prisma
      // raises P2025 rather than silently reporting a 0-row write.
      await expect(
        client.workspace.update({
          where: { id: workspaceA.id },
          data: { name: 'hijacked-by-B' },
        }),
      ).rejects.toThrow();
    });
    // Re-read via unscoped: workspaceA's name must be untouched.
    const reread = await unscoped.workspace.findUniqueOrThrow({ where: { id: workspaceA.id } });
    expect(reread.name).toBe(workspaceA.name);
  });

  it('T4c cross-tenant delete by id matches no row and throws (other tenant unchanged)', async () => {
    await run(tenantB.id, async () => {
      await expect(client.workspace.delete({ where: { id: workspaceA.id } })).rejects.toThrow();
    });
    // workspaceA must still exist - it was never in tenant B's scope.
    const reread = await unscoped.workspace.findUnique({ where: { id: workspaceA.id } });
    expect(reread).not.toBeNull();
  });

  it('T4b cross-tenant deleteMany by id removes 0 rows (other tenant unchanged)', async () => {
    await run(tenantB.id, async () => {
      // Bulk-delete attempt on tenant A's workspace while scoped to tenant B: the
      // scope-merged where matches 0 rows. (Also guards the deleteMany operation
      // against being dropped from the extension switch again.)
      const { count } = await client.workspace.deleteMany({ where: { id: workspaceA.id } });
      expect(count).toBe(0);
    });
    // workspaceA must still exist - it was never in tenant B's scope.
    const reread = await unscoped.workspace.findUnique({ where: { id: workspaceA.id } });
    expect(reread).not.toBeNull();
  });

  it('T5 create auto-stamps the active tenant id', async () => {
    const name = `iso-created-${randomUUID()}`;
    let createdId: string | undefined;
    await run(tenantB.id, async () => {
      // `tenantId` is left out on purpose: the extension stamps it, which the
      // plain PrismaClient type cannot know, so the omission is spelled out.
      const created = await client.workspace.create({
        data: { name } as { name: string; tenantId: string },
      });
      createdId = created.id;
      createdWorkspaceIds.add(created.id);
    });
    expect(createdId).toBeDefined();
    // Read back via unscoped: the row must belong to tenant B even though the
    // create payload never named a tenant.
    const reread = await unscoped.workspace.findUniqueOrThrow({
      where: { id: createdId as string },
    });
    expect(reread.tenantId).toBe(tenantB.id);
  });

  it('T8 update cannot move a row to another tenant (data.tenantId is stripped)', async () => {
    // Scoped to tenant B, try to BOTH rename workspaceB AND donate it to tenant A.
    await run(tenantB.id, async () => {
      await client.workspace.update({
        where: { id: workspaceB.id },
        data: { tenantId: tenantA.id, name: 'moved' },
      });
    });
    // Re-read via unscoped: the legit field (name) wrote, but the tenant did NOT
    // change - the strip is surgical, not a blanket no-op.
    const reread = await unscoped.workspace.findUniqueOrThrow({ where: { id: workspaceB.id } });
    expect(reread.tenantId).toBe(tenantB.id);
    expect(reread.name).toBe('moved');
  });

  it('T8b update cannot move a row via a nested relation write (data.tenant.connect)', async () => {
    // The scalar `tenantId` is stripped from `data`, but the RELATION that owns
    // that FK is a second door to the same field. Prisma's update payload
    // exposes `tenant: { connect | create | connectOrCreate | update | upsert }`,
    // none of which the scalar strip touches.
    await run(tenantB.id, async () => {
      await expect(
        client.workspace.update({
          where: { id: workspaceB.id },
          data: { tenant: { connect: { id: tenantA.id } } } as unknown as { name: string },
        }),
      ).rejects.toThrow("may not target the 'tenant' relation");
    });
    const reread = await unscoped.workspace.findUniqueOrThrow({ where: { id: workspaceB.id } });
    expect(reread.tenantId).toBe(tenantB.id);
  });

  it('T8c upsert cannot move a row via a nested relation write in its update branch', async () => {
    await run(tenantB.id, async () => {
      await expect(
        client.workspace.upsert({
          where: { id: workspaceB.id },
          create: { name: `iso-upsert-${randomUUID()}` },
          update: { tenant: { connect: { id: tenantA.id } } },
        } as unknown as Parameters<typeof client.workspace.upsert>[0]),
      ).rejects.toThrow("may not target the 'tenant' relation");
    });
    const reread = await unscoped.workspace.findUniqueOrThrow({ where: { id: workspaceB.id } });
    expect(reread.tenantId).toBe(tenantB.id);
  });

  it('T12 concurrent same-tick findUnique across tenants does not cross the batch', async () => {
    // Prisma batches findUnique calls issued in the same tick, and builds the
    // batch key from argument key NAMES, not values. Two tenants reading the
    // same id with an identically shaped where therefore share a batch. Prove
    // the scope value still decides who sees the row.
    let seenByA: unknown;
    let seenByB: unknown;
    await Promise.all([
      run(tenantA.id, async () => {
        seenByA = await client.workspace.findUnique({ where: { id: workspaceA.id } });
      }),
      run(tenantB.id, async () => {
        seenByB = await client.workspace.findUnique({ where: { id: workspaceA.id } });
      }),
    ]);
    expect(seenByA).not.toBeNull();
    expect(seenByB).toBeNull();
  });

  it('T13 a compound-unique selector carrying another tenant id matches no row', async () => {
    // `where: { tenantId_name: { tenantId: <A>, name: <A> } }` is the one
    // selector that literally carries a foreign tenant id into the query. The
    // merged top-level scope key must AND with it and win.
    await run(tenantB.id, async () => {
      const row = await client.workspace.findUnique({
        where: { tenantId_name: { tenantId: tenantA.id, name: workspaceA.name } },
      });
      expect(row).toBeNull();

      await expect(
        client.workspace.update({
          where: { tenantId_name: { tenantId: tenantA.id, name: workspaceA.name } },
          data: { name: 'hijacked-via-compound' },
        }),
      ).rejects.toThrow();
    });
    const reread = await unscoped.workspace.findUniqueOrThrow({ where: { id: workspaceA.id } });
    expect(reread.name).toBe(workspaceA.name);
  });

  it('T9 create ignores a client-supplied tenantId and stamps the active tenant', async () => {
    const name = `iso-donation-${randomUUID()}`;
    let createdId: string | undefined;
    // Scoped to tenant B, try to plant a row under tenant A via data.tenantId.
    await run(tenantB.id, async () => {
      const created = await client.workspace.create({
        data: { name, tenantId: tenantA.id } as { name: string; tenantId: string },
      });
      createdId = created.id;
      createdWorkspaceIds.add(created.id);
    });
    expect(createdId).toBeDefined();
    // Read back via unscoped: the ALS tenant (B) wins over the payload tenantId.
    const reread = await unscoped.workspace.findUniqueOrThrow({
      where: { id: createdId as string },
    });
    expect(reread.tenantId).toBe(tenantB.id);
  });

  it('T10 updateMany cannot move rows to another tenant (data.tenantId is stripped)', async () => {
    // Scoped to tenant B, try to bulk-rename AND donate B's rows to tenant A.
    await run(tenantB.id, async () => {
      await client.workspace.updateMany({
        where: { id: workspaceB.id },
        data: { tenantId: tenantA.id, name: 'bulk-moved' },
      });
    });
    // Re-read via unscoped: the legit field wrote, the tenant did not change.
    const reread = await unscoped.workspace.findUniqueOrThrow({ where: { id: workspaceB.id } });
    expect(reread.tenantId).toBe(tenantB.id);
    expect(reread.name).toBe('bulk-moved');
  });

  it('T6 fail-closed: a workspace query with no tenant in context throws', async () => {
    // No ALS store at all (called outside requestContext.run).
    await expect(client.workspace.findMany()).rejects.toThrow('Tenant context required');

    // Also fail-closed when a store exists but lacks tenantId.
    await requestContext.run({ requestId: 'iso-no-tenant' }, async () => {
      await expect(client.workspace.findMany()).rejects.toThrow('Tenant context required');
    });
  });

  // Transactional integrity of the scoped client. The scope rewrite must run on
  // the SAME connection as the surrounding interactive transaction, otherwise a
  // scoped write is autocommitted on the root connection and survives a rollback.
  // That would make `$transaction` cosmetic for every scoped model.
  it('T11 a scoped update inside a rolled-back transaction does not persist', async () => {
    const before = await unscoped.workspace.findUniqueOrThrow({ where: { id: workspaceB.id } });
    const sentinel = `tx-rollback-${randomUUID()}`;

    await run(tenantB.id, async () => {
      await expect(
        client.$transaction(async (tx) => {
          await tx.workspace.update({ where: { id: workspaceB.id }, data: { name: sentinel } });
          // Abort: everything written in this callback must be rolled back.
          throw new Error('force-rollback');
        }),
      ).rejects.toThrow('force-rollback');
    });

    const after = await unscoped.workspace.findUniqueOrThrow({ where: { id: workspaceB.id } });
    expect(after.name).toBe(before.name);
    expect(after.name).not.toBe(sentinel);
  });

  it('T11b a scoped delete inside a rolled-back transaction does not persist', async () => {
    // A throwaway row owned by tenant B, so the delete is in-scope and would
    // genuinely match (this is not testing the cross-tenant no-match path).
    const victim = await unscoped.workspace.create({
      data: { name: `iso-tx-victim-${randomUUID()}`, tenantId: tenantB.id },
    });
    createdWorkspaceIds.add(victim.id);

    await run(tenantB.id, async () => {
      await expect(
        client.$transaction(async (tx) => {
          await tx.workspace.delete({ where: { id: victim.id } });
          throw new Error('force-rollback');
        }),
      ).rejects.toThrow('force-rollback');
    });

    const reread = await unscoped.workspace.findUnique({ where: { id: victim.id } });
    expect(reread).not.toBeNull();
  });

  it('T11c a scoped findUnique inside a transaction sees that transaction uncommitted write', async () => {
    const sentinel = `tx-read-own-${randomUUID()}`;
    let seenInside: string | undefined;

    await run(tenantB.id, async () => {
      await expect(
        client.$transaction(async (tx) => {
          // The write goes through updateMany, which is tx-bound in every version
          // of the extension. That isolates what this test measures to the READ:
          // a findUnique on the transaction connection observes the uncommitted
          // row, while one that escapes to the root connection cannot.
          await tx.workspace.updateMany({ where: { id: workspaceB.id }, data: { name: sentinel } });
          const row = await tx.workspace.findUnique({ where: { id: workspaceB.id } });
          seenInside = row?.name;
          throw new Error('force-rollback');
        }),
      ).rejects.toThrow('force-rollback');
    });

    expect(seenInside).toBe(sentinel);
  });

  it('T7 the deliberate unscoped leak: unscoped client sees BOTH tenants', async () => {
    // The unscoped client has NO tenant filter and NO ALS requirement. It sees
    // every tenant's rows. This is exactly why `unscoped` is allowlisted and
    // lint-guarded: the extension on `client` is the only isolation boundary in
    // the app, and bypassing it via `unscoped` defeats tenant isolation.
    const rows = await unscoped.workspace.findMany({
      where: { id: { in: [workspaceA.id, workspaceB.id] } },
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(workspaceA.id);
    expect(ids).toContain(workspaceB.id);
  });
});
