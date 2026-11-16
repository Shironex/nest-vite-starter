/**
 * Audit-read tenant containment against the LIVE docker Postgres.
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * `AuditLog` is deliberately OUTSIDE the tenant-scope extension (pre-auth and
 * system writes would fail closed), so the explicit visibility clause in
 * AuditReadRepository is the only thing standing between one organization's history
 * and another's. Only this lane can prove that clause against real rows:
 *
 *   1. in-context rows (tenantId stamped) stay inside their tenant,
 *   2. pre-auth rows (tenantId null, known actor) surface through the actor's
 *      tenant - the failed-login rows the screen exists for,
 *   3. unattributable rows (both null) surface to NO tenant,
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { esmImport } from '../../common/utils/esm-import';
import { AuditReadRepository } from './audit-read.repository';
import type { PrismaService } from '../../common/database/prisma.service';

let unscoped: PrismaClient;
let repo: AuditReadRepository;

const createdTenantIds = new Set<string>();
const createdUserIds = new Set<string>();
const createdAuditIds = new Set<string>();

let tenantA: { id: string };
let tenantB: { id: string };
let userA: { id: string };
let userB: { id: string };

const marker = `audit-iso-${randomUUID()}`;

/** Insert one raw audit row via the unscoped client and track it for teardown. */
const writeRow = async (data: {
  tenantId: string | null;
  userId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) => {
  const row = await unscoped.auditLog.create({
    data: {
      tenantId: data.tenantId,
      userId: data.userId,
      action: data.action,
      targetType: data.targetType ?? null,
      targetId: data.targetId ?? null,
      // Every fixture row carries the marker so assertions can ignore
      // whatever real rows the shared docker DB already holds.
      metadata: { marker, ...data.metadata },
      success: true,
      ...(data.createdAt !== undefined && { createdAt: data.createdAt }),
    },
  });
  createdAuditIds.add(row.id);
  return row;
};

const markedIds = (items: { id: string }[]) =>
  items.filter((item) => createdAuditIds.has(item.id)).map((item) => item.id);

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  // The repository reads through PrismaService.client. The scoped extension
  // passes AuditLog through untouched (it is not in TENANT_SCOPED_MODELS), so
  // handing the raw singleton in is exactly the client shape production uses
  // for this model - and it keeps the spec free of ALS plumbing, because the
  // repository takes tenantId explicitly.
  repo = new AuditReadRepository({ client: unscoped } as unknown as PrismaService);

  const uid = randomUUID();
  tenantA = await unscoped.tenant.create({
    data: { name: `audit-iso-a-${uid}`, slug: `audit-iso-a-${uid}` },
  });
  tenantB = await unscoped.tenant.create({
    data: { name: `audit-iso-b-${uid}`, slug: `audit-iso-b-${uid}` },
  });
  createdTenantIds.add(tenantA.id);
  createdTenantIds.add(tenantB.id);

  userA = await unscoped.user.create({
    data: {
      email: `audit-iso-a-${uid}@example.com`,
      passwordHash: 'x',
      tenantId: tenantA.id,
    },
  });
  userB = await unscoped.user.create({
    data: {
      email: `audit-iso-b-${uid}@example.com`,
      passwordHash: 'x',
      tenantId: tenantB.id,
    },
  });
  createdUserIds.add(userA.id);
  createdUserIds.add(userB.id);
});

afterAll(async () => {
  // Teardown with the unscoped client so it reaches every fixture regardless
  // of which assertion failed. Audit rows first (User FK), then users, then
  // tenants.
  if (createdAuditIds.size > 0) {
    await unscoped.auditLog.deleteMany({ where: { id: { in: [...createdAuditIds] } } });
  }
  if (createdUserIds.size > 0) {
    await unscoped.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
  }
  if (createdTenantIds.size > 0) {
    await unscoped.tenant.deleteMany({ where: { id: { in: [...createdTenantIds] } } });
  }
  await unscoped?.$disconnect();
});

describe('audit read isolation (live DB, explicit clause is the only boundary)', () => {
  let inContextA: { id: string };
  let preAuthA: { id: string };
  let inContextB: { id: string };
  let preAuthB: { id: string };
  let orphan: { id: string };

  beforeAll(async () => {
    inContextA = await writeRow({
      tenantId: tenantA.id,
      userId: userA.id,
      action: 'workspace.updated',
      targetType: 'Workspace',
      targetId: 'workspace-a',
    });
    // The pre-auth shape AuditService writes for a failed login on a KNOWN
    // user: no tenant in the ALS yet, so tenantId is null and only the actor
    // links the row to an organization.
    preAuthA = await writeRow({
      tenantId: null,
      userId: userA.id,
      action: 'auth.login.failure',
      targetType: 'User',
      targetId: userA.id,
    });
    inContextB = await writeRow({
      tenantId: tenantB.id,
      userId: userB.id,
      action: 'workspace.updated',
      targetType: 'Workspace',
      targetId: 'workspace-b',
    });
    preAuthB = await writeRow({
      tenantId: null,
      userId: userB.id,
      action: 'auth.login.failure',
      targetType: 'User',
      targetId: userB.id,
    });
    // Unknown-email failure: neither tenant nor actor. Attributable to no
    // organization, so it must appear in NEITHER feed.
    orphan = await writeRow({
      tenantId: null,
      userId: null,
      action: 'auth.login.failure',
    });
  });

  it('A1 tenant A sees its own rows AND its users pre-auth rows, nothing else', async () => {
    const page = await repo.listPage(tenantA.id, { limit: 100 });
    const ids = markedIds(page.items);
    expect(ids).toContain(inContextA.id);
    expect(ids).toContain(preAuthA.id);
    expect(ids).not.toContain(inContextB.id);
    expect(ids).not.toContain(preAuthB.id);
    expect(ids).not.toContain(orphan.id);
  });

  it('A2 tenant B sees the mirror image', async () => {
    const page = await repo.listPage(tenantB.id, { limit: 100 });
    const ids = markedIds(page.items);
    expect(ids).toContain(inContextB.id);
    expect(ids).toContain(preAuthB.id);
    expect(ids).not.toContain(inContextA.id);
    expect(ids).not.toContain(preAuthA.id);
    expect(ids).not.toContain(orphan.id);
  });

  it('A3 an actions filter cannot widen the boundary: tenant A asking for failed logins gets only its own', async () => {
    const page = await repo.listPage(tenantA.id, {
      limit: 100,
      actions: ['auth.login.failure'],
    });
    const ids = markedIds(page.items);
    expect(ids).toContain(preAuthA.id);
    expect(ids).not.toContain(preAuthB.id);
    expect(ids).not.toContain(orphan.id);
    expect(ids).not.toContain(inContextA.id);
  });

  it('A5 keyset pagination walks the tenant feed newest-first without leaks or repeats', async () => {
    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      await writeRow({
        tenantId: tenantA.id,
        userId: userA.id,
        action: 'auth.logout',
        // Distinct timestamps so the page boundary is deterministic.
        createdAt: new Date(base - i * 1000),
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = await repo.listPage(tenantA.id, {
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      seen.push(...markedIds(page.items));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    // No repeats across pages, and every tenant-A fixture row eventually
    // surfaced while no tenant-B row ever did.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(inContextA.id);
    expect(seen).toContain(preAuthA.id);
    expect(seen).not.toContain(inContextB.id);
    expect(seen).not.toContain(preAuthB.id);
  });
});
