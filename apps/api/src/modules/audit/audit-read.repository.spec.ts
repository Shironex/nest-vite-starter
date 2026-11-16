import { Test } from '@nestjs/testing';
import { AuditReadRepository } from './audit-read.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { buildPrismaMock } from '@test/test-module';

const buildSubject = async () => {
  const prisma = buildPrismaMock();
  // buildPrismaMock's auditLog delegate only carries the writer's `create`.
  // Wire a local findMany stub here (the shared factory stays writer-shaped),
  // mirroring how user.repository.spec added `secondFactor`.
  const findMany = jest.fn().mockResolvedValue([]);
  (prisma.client.auditLog as unknown as { findMany: jest.Mock }).findMany = findMany;
  const module = await Test.createTestingModule({
    providers: [AuditReadRepository, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return { repo: module.get(AuditReadRepository), findMany };
};

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  action: 'workspace.updated',
  targetType: 'Workspace',
  targetId: 'workspace-1',
  before: null,
  after: null,
  metadata: { fields: ['city'] },
  reason: null,
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
  correlationId: 'req-1',
  success: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  user: { id: 'u-1', email: 'a@example.com', displayName: 'A' },
  ...overrides,
});

// These tests pin the literal visibility clause onto the Prisma where-clause.
// `AuditLog` is deliberately outside the tenant-scope extension, so this
// explicit clause IS the cross-tenant containment for the read surface.
describe('AuditReadRepository tenant containment', () => {
  it('always sends the two-arm visibility clause for the given tenant', async () => {
    const { repo, findMany } = await buildSubject();
    await repo.listPage('tenant-a', { limit: 25 });

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      AND: [
        {
          OR: [{ tenantId: 'tenant-a' }, { tenantId: null, user: { tenantId: 'tenant-a' } }],
        },
      ],
    });
  });

  it('never lets the actor fallback reach a row that carries its own tenantId', async () => {
    // The move case: an account leaves organization A for organization B. A
    // stamped row stays with A because the
    // fallback arm is gated on `tenantId: null`, so B's admin reading their own
    // audit view cannot pull A-era rows through the actor relation.
    const { repo, findMany } = await buildSubject();
    await repo.listPage('tenant-b', { limit: 25, actorId: 'moved-user' });

    const [visibility] = findMany.mock.calls[0][0].where.AND;
    const [ownArm, fallbackArm] = visibility.OR;
    expect(ownArm).toEqual({ tenantId: 'tenant-b' });
    expect(fallbackArm).toEqual({ tenantId: null, user: { tenantId: 'tenant-b' } });
    // The fallback must never be a bare actor match: that is what would move a
    // stamped row between organizations.
    expect(fallbackArm).not.toEqual({ user: { tenantId: 'tenant-b' } });
    expect(Object.keys(fallbackArm)).toContain('tenantId');
  });

  it('ANDs every filter alongside the visibility clause, never inside its OR', async () => {
    const { repo, findMany } = await buildSubject();
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-31T00:00:00Z');
    await repo.listPage('tenant-a', {
      limit: 25,
      actorId: 'u-9',
      actions: ['auth.login.failure', 'auth.login.locked'],
      from,
      to,
    });

    const args = findMany.mock.calls[0][0];
    expect(args.where.AND).toEqual([
      {
        OR: [{ tenantId: 'tenant-a' }, { tenantId: null, user: { tenantId: 'tenant-a' } }],
      },
      { userId: 'u-9' },
      { action: { in: ['auth.login.failure', 'auth.login.locked'] } },
      { createdAt: { gte: from, lte: to } },
    ]);
  });

  it('orders newest first with the id tiebreaker and pages by keyset cursor', async () => {
    const { repo, findMany } = await buildSubject();
    await repo.listPage('tenant-a', { limit: 10, cursor: 'a-10' });

    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    // limit + 1 probes for the next page without a COUNT; skip: 1 excludes the
    // cursor row itself.
    expect(args.take).toBe(11);
    expect(args.cursor).toEqual({ id: 'a-10' });
    expect(args.skip).toBe(1);
  });

  it('omits cursor args entirely on the first page', async () => {
    const { repo, findMany } = await buildSubject();
    await repo.listPage('tenant-a', { limit: 10 });

    const args = findMany.mock.calls[0][0];
    expect(args).not.toHaveProperty('cursor');
    expect(args).not.toHaveProperty('skip');
  });

  it('slices the probe row off and mints its predecessor as nextCursor', async () => {
    const { repo, findMany } = await buildSubject();
    findMany.mockResolvedValue([row('a-1'), row('a-2'), row('a-3')]);

    const page = await repo.listPage('tenant-a', { limit: 2 });
    expect(page.items.map((item) => item.id)).toEqual(['a-1', 'a-2']);
    expect(page.nextCursor).toBe('a-2');
  });

  it('returns a null nextCursor on the final page', async () => {
    const { repo, findMany } = await buildSubject();
    findMany.mockResolvedValue([row('a-1'), row('a-2')]);

    const page = await repo.listPage('tenant-a', { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('maps the user relation onto the wire actor and keeps system rows null', async () => {
    const { repo, findMany } = await buildSubject();
    findMany.mockResolvedValue([row('a-1'), row('a-2', { user: null })]);

    const page = await repo.listPage('tenant-a', { limit: 10 });
    expect(page.items[0]!.actor).toEqual({ id: 'u-1', email: 'a@example.com', displayName: 'A' });
    expect(page.items[0]).not.toHaveProperty('user');
    expect(page.items[1]!.actor).toBeNull();
  });
});
