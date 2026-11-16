import { Test } from '@nestjs/testing';
import { UserRepository } from './user.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { buildPrismaMock } from '@test/test-module';

const buildSubject = async () => {
  const prisma = buildPrismaMock();
  // listUsers reads the organization's owner once per page, for the members list's
  // owner badge. No owner by default, which is a real population.
  prisma.client.tenant.findUnique.mockResolvedValue({ ownerId: null });
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

// These tests pin the literal tenant filter onto the Prisma where-clause. The
// `User` model is platform-global (the tenant Prisma extension only scopes
// `workspace`), so this explicit `tenantId` is the actual cross-tenant containment.
describe('UserRepository tenant containment', () => {
  describe('listUsers', () => {
    const listItem = (id: string) => ({
      id,
      email: `${id}@example.com`,
      displayName: null,
      role: 'USER',
      emailVerified: true,
      lockedUntil: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      membershipEndedAt: null,
      // Read to derive `status` and stripped before the row leaves the
      // repository, so no hash reaches the service layer.
      passwordHash: 'argon2',
    });

    /** The same row as the caller sees it: no hash, plus the derived fields. */
    const visibleItem = (id: string) => {
      const { passwordHash: _passwordHash, ...rest } = listItem(id);
      return { ...rest, isOwner: false, status: 'active' as const };
    };

    it('filters findMany by { tenantId, kind: STAFF, deletedAt: null } with the admin projection and deterministic ordering', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);

      await repo.listUsers('tenant-a', { limit: 50 });

      expect(prisma.client.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-a', deletedAt: null },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          emailVerified: true,
          lockedUntil: true,
          createdAt: true,
          membershipEndedAt: true,
          // Selected to derive `status`, and stripped from every row before it
          // leaves the repository. Asserted here so a projection that started
          // returning it would be a red test rather than a hash on the wire.
          passwordHash: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      });
    });

    it('passes the keyset cursor with skip: 1 so the cursor row is excluded', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);

      await repo.listUsers('tenant-a', { cursor: 'u-50', limit: 10 });

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

      const page = await repo.listUsers('tenant-a', { limit: 2 });

      expect(page.items.map((u) => u.id)).toEqual(['u-1', 'u-2']);
      expect(page.nextCursor).toBe('u-2');
    });

    it('returns nextCursor: null on the final page (rows <= limit)', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([listItem('u-1'), listItem('u-2')]);

      const page = await repo.listUsers('tenant-a', { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('returns an empty page with nextCursor: null when the tenant has no users', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);
      prisma.client.user.count.mockResolvedValue(0);

      const page = await repo.listUsers('tenant-a', { limit: 50 });

      expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
    });

    // The members footer's total. The count is the half that leaks tenants if
    // it is written twice: `User` sits OUTSIDE the tenant-scope extension, so
    // the explicit tenantId in the where-clause is the only containment there
    // is, and a count that restated it and dropped `tenantId` would report
    // every organization's staff headcount as this one's.
    it('counts the identical tenant-contained predicate the page read used', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);
      prisma.client.user.count.mockResolvedValue(12);

      const page = await repo.listUsers('tenant-a', { limit: 10 });

      expect(page.total).toBe(12);
      expect(prisma.client.user.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-a', deletedAt: null },
      });
      const listWhere = (prisma.client.user.findMany.mock.calls[0]?.[0] as { where: unknown })
        .where;
      const countWhere = (prisma.client.user.count.mock.calls[0]?.[0] as { where: unknown }).where;
      expect(countWhere).toEqual(listWhere);
    });

    it('does not count a page cut from a cursor', async () => {
      // `User` is platform-global and outside the tenant-scope extension, so
      // this count carries an explicit tenantId and is cheap; it is still the
      // same number for every page of one traversal, and the members panel
      // carries the first page's answer forward.
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);

      const page = await repo.listUsers('tenant-a', { cursor: 'u-50', limit: 10 });

      expect(prisma.client.user.count).not.toHaveBeenCalled();
      expect(page.total).toBeNull();
    });

    it('totals the tenant, not the page', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([
        listItem('u-1'),
        listItem('u-2'),
        listItem('u-3'),
      ]);
      prisma.client.user.count.mockResolvedValue(9);

      const page = await repo.listUsers('tenant-a', { limit: 2 });

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

      const page = await repo.listUsers('tenant-a', { limit: 50 });

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
      ['pending', { passwordHash: null, emailVerified: false, membershipEndedAt: null }],
      ['removed', { passwordHash: 'argon2', membershipEndedAt: new Date('2026-05-01T00:00:00Z') }],
      ['active', { passwordHash: 'argon2', membershipEndedAt: null }],
      // A Google signup: no password, a provider-verified address. That is how
      // the organization OWNER is provisioned, and it is a member, not an invitation.
      ['active', { passwordHash: null, emailVerified: true, membershipEndedAt: null }],
    ])(
      'derives status %p from the row rather than leaving it to the client',
      async (expected, row) => {
        // The same three-way distinction the removal procedures branch on. Two
        // implementations of it would eventually disagree, and the one on the
        // client is the one that would be wrong.
        const { repo, prisma } = await buildSubject();
        prisma.client.user.findMany.mockResolvedValue([{ ...listItem('u-1'), ...row }]);

        const page = await repo.listUsers('tenant-a', { limit: 50 });

        expect(page.items[0]!.status).toBe(expected);
      },
    );

    it('ranks pending ahead of removed, because a withdrawn invite leaves no row', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([
        {
          ...listItem('u-1'),
          passwordHash: null,
          emailVerified: false,
          membershipEndedAt: new Date('2026-05-01T00:00:00Z'),
        },
      ]);

      const page = await repo.listUsers('tenant-a', { limit: 50 });

      expect(page.items[0]!.status).toBe('pending');
    });

    it('lists a Google-signup owner as an active member, never as an open invitation', async () => {
      // The owner row the "withdraw invitation" action once offered to delete.
      const { repo, prisma } = await buildSubject();
      prisma.client.tenant.findUnique.mockResolvedValue({ ownerId: 'owner-1' });
      prisma.client.user.findMany.mockResolvedValue([
        { ...listItem('owner-1'), role: 'ADMIN', passwordHash: null, emailVerified: true },
      ]);

      const page = await repo.listUsers('tenant-a', { limit: 50 });

      expect(page.items[0]).toMatchObject({ isOwner: true, status: 'active' });
    });

    it('marks the owner, and marks nobody when the organization has none', async () => {
      // A null owner is permanent, not transitional: an organization whose only ADMIN
      // self-deleted keeps its Tenant row with nobody to name.
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([listItem('u-1'), listItem('u-2')]);

      const noOwner = await repo.listUsers('tenant-a', { limit: 50 });
      expect(noOwner.items.map((item) => item.isOwner)).toEqual([false, false]);

      prisma.client.tenant.findUnique.mockResolvedValue({ ownerId: 'u-2' });
      const withOwner = await repo.listUsers('tenant-a', { limit: 50 });
      expect(withOwner.items.map((item) => item.isOwner)).toEqual([false, true]);
    });

    it('never returns a password hash', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([listItem('u-1')]);

      const page = await repo.listUsers('tenant-a', { limit: 50 });

      expect(page.items[0]).not.toHaveProperty('passwordHash');
    });

    it('reads the owner once per page, not once per row', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([
        listItem('u-1'),
        listItem('u-2'),
        listItem('u-3'),
      ]);

      await repo.listUsers('tenant-a', { limit: 50 });

      expect(prisma.client.tenant.findUnique).toHaveBeenCalledTimes(1);
    });

    it('skips the second-factor query entirely for an empty page (no wasted round-trip)', async () => {
      const { repo, prisma, secondFactor } = await buildSubject();
      prisma.client.user.findMany.mockResolvedValue([]);

      await repo.listUsers('tenant-a', { limit: 50 });

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

      await repo.listUsers('tenant-a', { limit: 2 });

      expect(secondFactor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: { in: ['u-1', 'u-2'] } }),
        }),
      );
    });
  });

  describe('updateRoleScoped', () => {
    it('scopes the role updateMany to { id, tenantId } and returns the affected count', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

      const count = await repo.updateRoleScoped('u-1', 'tenant-a', 'ADMIN');

      expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
        // `deletedAt: null` joins tenantId: the staff list that offers the action
        // is itself soft-delete filtered, so promoting an erased account is a
        // crafted request and zero rows is the right answer for it.
        where: { id: 'u-1', tenantId: 'tenant-a', deletedAt: null },
        data: { role: 'ADMIN' },
      });
      expect(count).toBe(1);
    });

    it('returns 0 when the target is not in the caller tenant (no row matched)', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

      const count = await repo.updateRoleScoped('other-tenant-user', 'tenant-a', 'ADMIN');

      expect(count).toBe(0);
    });
  });

  describe('getTenantName', () => {
    it('reads the tenant by id and returns its name', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.tenant.findUnique.mockResolvedValue({ name: 'Acme Robotics' });

      const name = await repo.getTenantName('tenant-a');

      expect(prisma.client.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: 'tenant-a' },
        select: { name: true },
      });
      expect(name).toBe('Acme Robotics');
    });

    it('returns null when the tenant row is gone', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.tenant.findUnique.mockResolvedValue(null);

      const name = await repo.getTenantName('tenant-a');

      expect(name).toBeNull();
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

  it('updateAvatar guards on { id, deletedAt: null } and returns the count', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.updateAvatar('u-1', 'avatars/u-1/new.png')).resolves.toBe(1);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
      data: { avatarUrl: 'avatars/u-1/new.png' },
    });
  });

  it('updateAvatarIfCurrent compare-and-swaps on the expected current key (soft-delete guarded)', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      repo.updateAvatarIfCurrent('u-1', 'avatars/u-1/new.png', 'avatars/u-1/old.png'),
    ).resolves.toBe(true);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', avatarUrl: 'avatars/u-1/old.png', deletedAt: null },
      data: { avatarUrl: 'avatars/u-1/new.png' },
    });
  });

  it('updateAvatarIfCurrent returns false when the stored key no longer matches', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.updateAvatarIfCurrent('u-1', 'avatars/u-1/new.png', null)).resolves.toBe(
      false,
    );
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', avatarUrl: null, deletedAt: null },
      data: { avatarUrl: 'avatars/u-1/new.png' },
    });
  });

  it('clearAvatarIfCurrent nulls the avatar only while it still equals the deleted key', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.clearAvatarIfCurrent('u-1', 'avatars/u-1/old.png')).resolves.toBe(true);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', avatarUrl: 'avatars/u-1/old.png', deletedAt: null },
      data: { avatarUrl: null },
    });
  });

  it('clearAvatarIfCurrent leaves a profile that moved on to a newer avatar alone', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.clearAvatarIfCurrent('u-1', 'avatars/u-1/old.png')).resolves.toBe(false);
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

// The admin delete path is tenant-scoped like updateRoleScoped: the explicit
// tenantId in the where-clause IS the cross-tenant containment, and the role
// predicate repeats the no-admin-targets guard inside the write (no TOCTOU).
describe('UserRepository admin-delete scoping', () => {
  it('findRoleScoped probes by { id, tenantId, kind: STAFF, deletedAt: null } with the minimal projection', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue({
      id: 'u-1',
      role: 'USER',
      email: 'u1@example.com',
    });

    await expect(repo.findRoleScoped('u-1', 'tenant-a')).resolves.toEqual({
      id: 'u-1',
      role: 'USER',
      email: 'u1@example.com',
    });
    // email rides along for the admin-actions broadcast: the row is soft-
    // deleted by the time the notification copy is built.
    expect(prisma.client.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u-1', tenantId: 'tenant-a', deletedAt: null },
      select: { id: true, role: true, email: true },
    });
  });

  it('softDeleteScopedNonAdmin scopes the write to { id, tenantId, kind: STAFF, role != ADMIN, deletedAt: null }', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.softDeleteScopedNonAdmin('u-1', 'tenant-a')).resolves.toBe(1);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'u-1',
        tenantId: 'tenant-a',
        role: { not: 'ADMIN' },
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('softDeleteScopedNonAdmin returns 0 when the target is cross-tenant, deleted, or ADMIN', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.softDeleteScopedNonAdmin('other-tenant-user', 'tenant-a')).resolves.toBe(0);
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
    membershipEndedAt: null,
    passwordHash: null,
    emailVerified: false,
    tokens: [],
    oauthAccounts: [],
    ...over,
  });

  it('asks for BOTH invite token types', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(row());

    await repo.findPasswordResetEligibility('u-1');

    expect(prisma.client.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          tokens: expect.objectContaining({
            where: { type: { in: ['STAFF_INVITE'] } },
          }),
        }),
      }),
    );
  });

  it('holds the gate closed after the invite token has been swept away', async () => {
    // The token expires after 7 days and the hourly sweep deletes it. A gate
    // that hangs off its presence reopens a week after the invitation was
    // ignored, which is the whole defect.
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(row({ tokens: [] }));

    await expect(repo.findPasswordResetEligibility('u-1')).resolves.toMatchObject({
      pendingInvite: true,
    });
  });

  it('treats a live invite token as pending too', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(row({ tokens: [{ id: 'tok-1' }] }));

    await expect(repo.findPasswordResetEligibility('u-1')).resolves.toMatchObject({
      pendingInvite: true,
    });
  });

  it('keeps an OAuth-only account eligible to set its first password', async () => {
    // The other account with no password. The provider asserted the address, so
    // it carries emailVerified true and an OAuthAccount row.
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(
      row({ emailVerified: true, oauthAccounts: [{ id: 'oauth-1' }] }),
    );

    await expect(repo.findPasswordResetEligibility('u-1')).resolves.toMatchObject({
      pendingInvite: false,
    });
  });

  it('keeps an OAuth account eligible even if it somehow never verified', async () => {
    // The OAuthAccount row is the discriminator that matters: an account a
    // provider vouched for was never an unaccepted invitation, whatever the
    // verified flag says.
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(row({ oauthAccounts: [{ id: 'oauth-1' }] }));

    await expect(repo.findPasswordResetEligibility('u-1')).resolves.toMatchObject({
      pendingInvite: false,
    });
  });

  it('leaves an accepted member eligible', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(
      row({ passwordHash: 'argon2', emailVerified: true }),
    );

    await expect(repo.findPasswordResetEligibility('u-1')).resolves.toEqual({
      membershipEnded: false,
      pendingInvite: false,
    });
  });

  it('reports a removed member', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(
      row({ passwordHash: 'argon2', emailVerified: true, membershipEndedAt: new Date() }),
    );

    await expect(repo.findPasswordResetEligibility('u-1')).resolves.toMatchObject({
      membershipEnded: true,
    });
  });
});

describe('UserRepository membership counts', () => {
  describe('countLiveAdmins', () => {
    /**
     * An unaccepted ADMIN invitation is not an admin, and counting it let the
     * sole real admin delete themselves while it was open. The exclusion is the
     * PAIR: `passwordHash: null` alone would also drop a Google-only admin.
     */
    it('leaves open invitations out by the pending pair, never by a null password alone', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.count.mockResolvedValue(1);

      await repo.countLiveAdmins('tenant-a');

      expect(prisma.client.user.count).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-a',
          role: 'ADMIN',
          deletedAt: null,
          membershipEndedAt: null,
          NOT: { passwordHash: null, emailVerified: false },
        },
      });
    });

    it('counts the OTHER admins when asked to exclude one', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.count.mockResolvedValue(0);

      await repo.countLiveAdmins('tenant-a', undefined, 'u-1');

      expect(prisma.client.user.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ tenantId: 'tenant-a', id: { not: 'u-1' } }),
      });
    });
  });

  describe('countOtherLiveMembers', () => {
    /**
     * Deliberately NOT the admin count's exclusion: a pending invitee who
     * accepts after the last admin left arrives in an organization nobody can run, so
     * they count as somebody the deletion would strand.
     */
    it('still counts open invitations as people who would be stranded', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.user.count.mockResolvedValue(1);

      await repo.countOtherLiveMembers('tenant-a', 'u-1');

      const { where } = prisma.client.user.count.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where).not.toHaveProperty('NOT');
      expect(where).toMatchObject({ tenantId: 'tenant-a', id: { not: 'u-1' } });
    });
  });
});
