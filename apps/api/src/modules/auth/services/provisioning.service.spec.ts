import { ProvisioningService } from './provisioning.service';
import { buildPrismaTx, createAuthTestModule, mockPrismaTransaction } from '@test/test-module';
import { userFixture } from '@test/fixtures';

describe('ProvisioningService', () => {
  const buildCtx = async () => {
    const ctx = await createAuthTestModule();
    const service = ctx.get(ProvisioningService);
    return { ...ctx, service };
  };

  const baseArgs = {
    normalizedEmail: 'newuser@example.com',
    passwordHash: 'hashed-pw',
    displayName: 'New User' as string | null,
  };

  it('creates the tenant, the owner ADMIN and the verification token on ONE transaction', async () => {
    const { service, mocks } = await buildCtx();
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-2', name: 'newuser', slug: 'newuser-abcd1234' });
    const created = userFixture({ id: 'u-2', role: 'ADMIN', tenantId: 't-2' });
    tx.user.create.mockResolvedValue(created);
    mocks.token.createVerificationToken.mockResolvedValue('a'.repeat(64));

    const result = await service.provisionOrganizationForPasswordSignup(baseArgs);

    expect(result).toEqual({ user: created, rawVerificationToken: 'a'.repeat(64) });
    expect(mocks.prisma.client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.tenant.create).toHaveBeenCalledTimes(1);
    // The owner is the organization ADMIN attached to the tenant just created.
    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        email: 'newuser@example.com',
        passwordHash: 'hashed-pw',
        displayName: 'New User',
        role: 'ADMIN',
        tenantId: 't-2',
      },
    });
    // Minted through the ONE shared TokenService path, on the SAME tx.
    expect(mocks.token.createVerificationToken).toHaveBeenCalledWith('u-2', tx);
    // The founder is recorded as the owner. Without this the person the organization
    // was provisioned around is indistinguishable from anyone later promoted to
    // ADMIN, which is what the owner guards exist to tell apart.
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: 't-2' },
      data: { owner: { connect: { id: 'u-2' } } },
    });
  });

  /**
   * The stamp cannot ride the tenant create (its target does not exist yet) and
   * must not be deferred to a later write: an unowned organization is exactly the state
   * the owner guards read as "the owner rule does not apply here", so a failure
   * between the two statements would quietly produce an organization nobody owns.
   */
  it('stamps the owner on the SAME transaction as the tenant and the user', async () => {
    const { service, mocks } = await buildCtx();
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-7', name: 'newuser', slug: 'newuser-x' });
    tx.user.create.mockResolvedValue(userFixture({ id: 'u-7', role: 'ADMIN', tenantId: 't-7' }));
    mocks.token.createVerificationToken.mockResolvedValue('b'.repeat(64));

    await service.provisionOrganizationForPasswordSignup(baseArgs);

    expect(mocks.prisma.client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.tenant.update).toHaveBeenCalledTimes(1);
    // Nothing outside the transaction touched the tenant.
    expect(mocks.prisma.client.tenant.update).not.toHaveBeenCalled();
  });

  it('never mints per-user RolePermission rows for the owner', async () => {
    const { service, mocks } = await buildCtx();
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-3', name: 'newuser', slug: 'newuser-x' });
    tx.user.create.mockResolvedValue(userFixture({ id: 'u-3', role: 'ADMIN', tenantId: 't-3' }));
    mocks.token.createVerificationToken.mockResolvedValue('b'.repeat(64));

    await service.provisionOrganizationForPasswordSignup(baseArgs);

    // ADMIN powers come from the global seeded role-level grant
    // (role: ADMIN, userId: null). Per-user rows would SURVIVE a later
    // downgrade to USER and leave a downgraded owner with live admin powers.
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it('derives a slug from the email local-part plus a random suffix', async () => {
    const { service, mocks } = await buildCtx();
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-4', name: 'admin', slug: 'admin-x' });
    tx.user.create.mockResolvedValue(userFixture({ id: 'u-4', role: 'ADMIN', tenantId: 't-4' }));
    mocks.token.createVerificationToken.mockResolvedValue('c'.repeat(64));

    await service.provisionOrganizationForPasswordSignup({
      ...baseArgs,
      normalizedEmail: 'admin@example.com',
    });

    const { data } = tx.tenant.create.mock.calls[0][0] as {
      data: { name: string; slug: string };
    };
    expect(data.name).toBe('admin');
    // The random suffix is what keeps admin@a.com and admin@b.com from
    // colliding on the @unique slug.
    expect(data.slug).toMatch(/^admin-[0-9a-f]{8}$/);
  });

  it('falls back to a usable slug when the local-part has no slug-safe characters', async () => {
    const { service, mocks } = await buildCtx();
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-5', name: '___', slug: 'organization-x' });
    tx.user.create.mockResolvedValue(userFixture({ id: 'u-5', role: 'ADMIN', tenantId: 't-5' }));
    mocks.token.createVerificationToken.mockResolvedValue('d'.repeat(64));

    await service.provisionOrganizationForPasswordSignup({
      ...baseArgs,
      normalizedEmail: '___@x.com',
    });

    const { data } = tx.tenant.create.mock.calls[0][0] as { data: { slug: string } };
    expect(data.slug).toMatch(/^organization-[0-9a-f]{8}$/);
  });

  it('passes displayName through as null when the caller has none', async () => {
    const { service, mocks } = await buildCtx();
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-6', name: 'newuser', slug: 'newuser-x' });
    tx.user.create.mockResolvedValue(userFixture({ id: 'u-6', role: 'ADMIN', tenantId: 't-6' }));
    mocks.token.createVerificationToken.mockResolvedValue('e'.repeat(64));

    await service.provisionOrganizationForPasswordSignup({ ...baseArgs, displayName: null });

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: null }) }),
    );
  });

  it('propagates a transaction failure so the caller can map P2002', async () => {
    const { service, mocks } = await buildCtx();
    mocks.prisma.client.$transaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
        code: 'P2002',
        meta: { target: ['email'] },
      }),
    );

    await expect(service.provisionOrganizationForPasswordSignup(baseArgs)).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  describe('provisionOrganizationForOAuthSignup()', () => {
    const oauthArgs = {
      normalizedEmail: 'newuser@example.com',
      displayName: 'New User' as string | null,
      avatarUrl: 'https://lh3.example/a' as string | null,
      provider: 'google',
      providerAccountId: 'sub-123',
    };

    it('creates tenant + passwordless verified owner + link row on ONE transaction, NO token', async () => {
      const { service, mocks } = await buildCtx();
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.tenant.create.mockResolvedValue({ id: 't-9', name: 'newuser', slug: 'newuser-x' });
      const created = userFixture({
        id: 'u-9',
        role: 'ADMIN',
        tenantId: 't-9',
        passwordHash: null,
        emailVerified: true,
      });
      tx.user.create.mockResolvedValue(created);
      tx.oAuthAccount.create.mockResolvedValue({ id: 'oa-9' });

      const result = await service.provisionOrganizationForOAuthSignup(oauthArgs);

      expect(result).toBe(created);
      expect(mocks.prisma.client.$transaction).toHaveBeenCalledTimes(1);
      // The SAME organization+owner shape as the password path, with the three locked
      // deltas: null hash, verified email, claims-derived profile fields.
      expect(tx.user.create).toHaveBeenCalledWith({
        data: {
          email: 'newuser@example.com',
          passwordHash: null,
          displayName: 'New User',
          avatarUrl: 'https://lh3.example/a',
          emailVerified: true,
          role: 'ADMIN',
          tenantId: 't-9',
        },
      });
      // Identical owner stamp to the password path: both entry points mint the
      // same Tenant + owner-ADMIN shape, which is why the transaction has one home.
      expect(tx.tenant.update).toHaveBeenCalledWith({
        where: { id: 't-9' },
        data: { owner: { connect: { id: 'u-9' } } },
      });
      // The link row commits with the user, on the same tx.
      expect(tx.oAuthAccount.create).toHaveBeenCalledWith({
        data: {
          provider: 'google',
          providerAccountId: 'sub-123',
          email: 'newuser@example.com',
          emailVerified: true,
          userId: 'u-9',
        },
      });
      // The provider already verified the mailbox: no verification token.
      expect(mocks.token.createVerificationToken).not.toHaveBeenCalled();
    });

    it('omits avatarUrl entirely when the claims carry none', async () => {
      const { service, mocks } = await buildCtx();
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.tenant.create.mockResolvedValue({ id: 't-10', name: 'newuser', slug: 'newuser-x' });
      tx.user.create.mockResolvedValue(
        userFixture({ id: 'u-10', role: 'ADMIN', tenantId: 't-10', passwordHash: null }),
      );
      tx.oAuthAccount.create.mockResolvedValue({ id: 'oa-10' });

      await service.provisionOrganizationForOAuthSignup({ ...oauthArgs, avatarUrl: null });

      const { data } = tx.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data).not.toHaveProperty('avatarUrl');
    });

    it('shares the password path slug derivation (local-part + random suffix)', async () => {
      const { service, mocks } = await buildCtx();
      const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
      tx.tenant.create.mockResolvedValue({ id: 't-11', name: 'admin', slug: 'admin-x' });
      tx.user.create.mockResolvedValue(
        userFixture({ id: 'u-11', role: 'ADMIN', tenantId: 't-11', passwordHash: null }),
      );
      tx.oAuthAccount.create.mockResolvedValue({ id: 'oa-11' });

      await service.provisionOrganizationForOAuthSignup({
        ...oauthArgs,
        normalizedEmail: 'admin@example.com',
      });

      const { data } = tx.tenant.create.mock.calls[0][0] as {
        data: { name: string; slug: string };
      };
      expect(data.name).toBe('admin');
      expect(data.slug).toMatch(/^admin-[0-9a-f]{8}$/);
    });

    it('propagates a transaction failure so the caller can map P2002', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.$transaction.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['email'] } }),
      );

      await expect(service.provisionOrganizationForOAuthSignup(oauthArgs)).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });
});
