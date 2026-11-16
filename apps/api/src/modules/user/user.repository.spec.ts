import { Test } from '@nestjs/testing';
import { UserRepository } from './user.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { buildPrismaMock } from '@test/test-module';

const buildSubject = async () => {
  const prisma = buildPrismaMock();
  // buildPrismaMock predates the 2FA feature and its `client` has no
  // `secondFactor` delegate. listUsers now batches an EXISTS query against it,
  // so wire a local stub here (defaulting to "no factors") rather than editing
  // the shared test-module factory. Cast because PrismaServiceMock's client
  // type does not declare the delegate.
  const secondFactor = { findMany: jest.fn().mockResolvedValue([]) };
  (prisma.client as unknown as { secondFactor: typeof secondFactor }).secondFactor = secondFactor;
  const module = await Test.createTestingModule({
    providers: [UserRepository, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return { repo: module.get(UserRepository), prisma, secondFactor };
};

describe('UserRepository admin list and role writes', () => {
  describe('listUsers', () => {
    const listItem = (id: string) => ({
      id,
      email: `${id}@example.com`,
      displayName: null,
      role: 'USER',
      emailVerified: true,
      lockedUntil: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      disabledAt: null,
    });

    /** The same row as the caller sees it, plus the derived fields. */
    const visibleItem = (id: string) => ({
      ...listItem(id),
      status: 'active' as const,
    });

    it('filters findMany by { deletedAt: null } with the admin projection and deterministic ordering', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);

      await repo.listUsers({ limit: 50 });

      expect(prisma.client.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          emailVerified: true,
          lockedUntil: true,
          createdAt: true,
          disabledAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      });
    });

    it('passes the keyset cursor with skip: 1 so the cursor row is excluded', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);

      await repo.listUsers({ cursor: 'u-50', limit: 10 });

      expect(prisma.client.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 11,
          cursor: { id: 'u-50' },
          skip: 1,
        }),
      );
    });

    it('returns nextCursor from the last page row when limit + 1 rows come back', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([
        listItem('u-1'),
        listItem('u-2'),
        listItem('u-3'),
      ]);

      const page = await repo.listUsers({ limit: 2 });

      expect(page.items.map((u) => u.id)).toEqual(['u-1', 'u-2']);
      expect(page.nextCursor).toBe('u-2');
    });

    it('returns nextCursor: null on the final page (rows <= limit)', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([listItem('u-1'), listItem('u-2')]);

      const page = await repo.listUsers({ limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('returns an empty page with nextCursor: null when there are no users', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);
      prisma.client.user.count.mockResolvedValue(0);

      const page = await repo.listUsers({ limit: 50 });

      expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
    });

    // The users footer's total: the count must use the same binding as the
    // page read, or the footer and the list drift apart.
    it('counts the identical predicate the page read used', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);
      prisma.client.user.count.mockResolvedValue(12);

      const page = await repo.listUsers({ limit: 10 });

      expect(page.total).toBe(12);
      expect(prisma.client.user.count).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });
      const listWhere = (prisma.client.user.findMany.mock.calls[0]?.[0] as { where: unknown })
        .where;
      const countWhere = (prisma.client.user.count.mock.calls[0]?.[0] as { where: unknown }).where;
      expect(countWhere).toEqual(listWhere);
    });

    it('does not count a page cut from a cursor', async () => {
      // The count is the same number for every page of one traversal, and the
      // users panel carries the first page's answer forward.
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);

      const page = await repo.listUsers({ cursor: 'u-50', limit: 10 });

      expect(prisma.client.user.count).not.toHaveBeenCalled();
      expect(page.total).toBeNull();
    });

    it('totals every live user, not the page', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([
        listItem('u-1'),
        listItem('u-2'),
        listItem('u-3'),
      ]);
      prisma.client.user.count.mockResolvedValue(9);

      const page = await repo.listUsers({ limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBe('u-2');
      expect(page.total).toBe(9);
    });

    // twoFactorEnabled is DERIVED (not a stored column): true iff an ACTIVE,
    // non-recovery SecondFactor row EXISTS. It is resolved for the whole page in
    // ONE batched query keyed by the page's user ids (never N+1).
    it('derives twoFactorEnabled per row from a single batched EXISTS query over the page ids', async () => {
      const { repo, prisma, secondFactor } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([
        listItem('u-1'),
        listItem('u-2'),
        listItem('u-3'),
      ]);
      // u-1 and u-3 have an ACTIVE non-recovery factor; u-2 does not.
      secondFactor.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-3' }]);

      const page = await repo.listUsers({ limit: 50 });

      // One batched query, filtered to ACTIVE non-recovery factors for the page.
      expect(secondFactor.findMany).toHaveBeenCalledTimes(1);
      expect(secondFactor.findMany).toHaveBeenCalledWith({
        where: {
          userId: { in: ['u-1', 'u-2', 'u-3'] },
          status: 'ACTIVE',
          type: { not: 'RECOVERY_CODE' },
        },
        select: { userId: true },
        distinct: ['userId'],
      });
      expect(page.items).toEqual([
        { ...visibleItem('u-1'), twoFactorEnabled: true },
        { ...visibleItem('u-2'), twoFactorEnabled: false },
        { ...visibleItem('u-3'), twoFactorEnabled: true },
      ]);
    });

    it.each([
      ['disabled', { disabledAt: new Date('2026-05-01T00:00:00Z') }],
      ['active', { disabledAt: null }],
    ])(
      'derives status %p from the row rather than leaving it to the client',
      async (expected, row) => {
        // The same distinction the disable procedures branch on. Two
        // implementations of it would eventually disagree, and the one on the
        // client is the one that would be wrong.
        const { repo, prisma } = await buildSubject();
        prisma.client.user.findMany.mockResolvedValue([{ ...listItem('u-1'), ...row }]);

        const page = await repo.listUsers({ limit: 50 });

        expect(page.items[0]!.status).toBe(expected);
      },
    );

    it('never returns a password hash', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([listItem('u-1')]);

      const page = await repo.listUsers({ limit: 50 });

      expect(page.items[0]).not.toHaveProperty('passwordHash');
    });

    it('skips the second-factor query entirely for an empty page (no wasted round-trip)', async () => {
      const { repo, prisma, secondFactor } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);

      await repo.listUsers({ limit: 50 });

      expect(secondFactor.findMany).not.toHaveBeenCalled();
    });

    it('batches only the page ids, not the extra keyset probe row', async () => {
      const { repo, prisma, secondFactor } = await buildSubject();
      // limit 2 with 3 rows: the 3rd row only signals hasMore and must NOT be
      // included in the second-factor batch.
      prisma.client.user.findMany.mockResolvedValue([
        listItem('u-1'),
        listItem('u-2'),
        listItem('u-3'),
      ]);

      await repo.listUsers({ limit: 2 });

      expect(secondFactor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: { in: ['u-1', 'u-2'] } }),
        }),
      );
    });
  });

  describe('updateRole', () => {
    it('writes the role on the live row only and returns the affected count', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

      const count = await repo.updateRole('u-1', 'ADMIN');

      expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
        // The users list that offers the action is itself soft-delete filtered,
        // so promoting an erased account is a crafted request and zero rows is
        // the right answer for it.
        where: { id: 'u-1', deletedAt: null },
        data: { role: 'ADMIN' },
      });
      expect(count).toBe(1);
    });

    it('returns 0 when no live row matched', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

      const count = await repo.updateRole('gone-user', 'ADMIN');

      expect(count).toBe(0);
    });
  });
});

// These tests pin the soft-delete guard onto every by-id write: a bare { id }
// update would mutate a soft-deleted user that every read already excludes.
describe('UserRepository guarded soft-delete writes', () => {
  it('updatePassword guards on { id, deletedAt: null } and returns the count', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.updatePassword('u-1', 'hash')).resolves.toBe(1);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
      data: { passwordHash: 'hash' },
    });
  });

  it('updatePassword runs on the supplied transaction client when given', async () => {
    const { repo, prisma } = await buildSubject();
    const tx = { user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };

    await expect(repo.updatePassword('u-1', 'hash', tx as never)).resolves.toBe(1);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
      data: { passwordHash: 'hash' },
    });
    // The non-tx client must not be touched.
    expect(prisma.client.user.updateMany).not.toHaveBeenCalled();
  });

  it('verifyEmail guards on { id, deletedAt: null } and returns the count', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.verifyEmail('ghost')).resolves.toBe(0);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'ghost', deletedAt: null },
      data: { emailVerified: true },
    });
  });

  it('softDelete guards on { id, deletedAt: null }, stamps deletedAt, and returns the count', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.softDelete('u-1')).resolves.toBe(1);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('softDelete returns 0 for an already-deleted user (idempotency signal, no throw)', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.softDelete('ghost')).resolves.toBe(0);
  });
});

// The role predicate repeats the no-admin-targets guard inside the write (no
// TOCTOU).
describe('UserRepository admin-delete and disable writes', () => {
  it('findRole probes by { id, deletedAt: null } with the minimal projection', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue({ id: 'u-1', role: 'USER' });

    await expect(repo.findRole('u-1')).resolves.toEqual({ id: 'u-1', role: 'USER' });
    expect(prisma.client.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
      select: { id: true, role: true },
    });
  });

  it('softDeleteNonAdmin scopes the write to { id, role != ADMIN, deletedAt: null }', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.softDeleteNonAdmin('u-1')).resolves.toBe(1);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', role: { not: 'ADMIN' }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('softDeleteNonAdmin returns 0 when the target is deleted or ADMIN', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.softDeleteNonAdmin('admin-user')).resolves.toBe(0);
  });

  it('disable repeats the non-admin and not-yet-disabled guards inside the write', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });
    const at = new Date('2026-05-01T00:00:00Z');

    await expect(repo.disable('u-1', at)).resolves.toBe(1);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null, role: { not: 'ADMIN' }, disabledAt: null },
      data: { disabledAt: at },
    });
  });

  it('enable only matches a disabled live row', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.enable('u-1')).resolves.toBe(0);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null, disabledAt: { not: null } },
      data: { disabledAt: null },
    });
  });
});

// Regression: a soft-deleted user must not authenticate or be re-targetable.
// Every finder the auth flows use (login's credential-by-email, password
// change / delete-account's credential-by-id, and the plain finders behind
// forgot-password and resend-verification) carries the notDeleted guard.
describe('UserRepository soft-deleted users are excluded from auth reads', () => {
  it('findCredentialByEmail (login) filters on deletedAt: null', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(null);

    await repo.findCredentialByEmail('a@b.c');

    expect(prisma.client.user.findFirst).toHaveBeenCalledWith({
      where: { email: 'a@b.c', deletedAt: null },
    });
  });

  it('findCredentialById (password change / delete account) filters on deletedAt: null', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(null);

    await repo.findCredentialById('u-1');

    expect(prisma.client.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
    });
  });

  it('findByEmail (forgot-password path) filters on deletedAt: null', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(null);

    await repo.findByEmail('a@b.c');

    expect(prisma.client.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'a@b.c', deletedAt: null } }),
    );
  });

  it('findById (resend-verification path) filters on deletedAt: null', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(null);

    await repo.findById('u-1');

    expect(prisma.client.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1', deletedAt: null } }),
    );
  });
});

describe('UserRepository password-reset eligibility', () => {
  /** The row as the eligibility projection returns it. */
  const row = (over: Record<string, unknown> = {}) => ({
    disabledAt: null,
    ...over,
  });

  it('leaves an active account eligible', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(row());

    await expect(repo.findPasswordResetEligibility('u-1')).resolves.toEqual({
      disabled: false,
    });
  });

  it('reports a disabled account', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(row({ disabledAt: new Date() }));

    await expect(repo.findPasswordResetEligibility('u-1')).resolves.toMatchObject({
      disabled: true,
    });
  });
});

describe('UserRepository admin and user counts', () => {
  describe('countLiveAdmins', () => {
    it('counts live, enabled ADMIN accounts only', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.count.mockResolvedValue(1);

      await repo.countLiveAdmins();

      expect(prisma.client.user.count).toHaveBeenCalledWith({
        where: {
          role: 'ADMIN',
          deletedAt: null,
          disabledAt: null,
        },
      });
    });

    it('counts the OTHER admins when asked to exclude one', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.count.mockResolvedValue(0);

      await repo.countLiveAdmins(undefined, 'u-1');

      expect(prisma.client.user.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: { not: 'u-1' } }),
      });
    });
  });

  describe('countOtherLiveUsers', () => {
    it('counts every other live user as somebody the deletion would strand', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.count.mockResolvedValue(1);

      await repo.countOtherLiveUsers('u-1');

      const { where } = prisma.client.user.count.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where).toEqual({ id: { not: 'u-1' }, deletedAt: null, disabledAt: null });
    });
  });
});

describe('UserRepository admin-set lock', () => {
  it('takes one global advisory xact lock through $executeRaw', async () => {
    const { repo } = await buildSubject();
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };

    await repo.lockAdminSet(tx as never);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, key] = tx.$executeRaw.mock.calls[0] as [readonly string[], string];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(key).toBe('admin-set');
  });
});
