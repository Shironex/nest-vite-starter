import { TRPCError } from '@trpc/server';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { RegisterService } from './register.service';
import { buildPrismaTx, createAuthTestModule, mockPrismaTransaction } from '@test/test-module';
import { expressMocks, userFixture, userProfileFixture } from '@test/fixtures';

describe('RegisterService', () => {
  const baseInput = {
    email: 'NewUser@Example.com',
    password: 'CorrectHorseBatteryStaple1!',
    displayName: 'New User',
    turnstileToken: 'turnstile-ok',
  };

  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [RegisterService] });
    const service = ctx.get(RegisterService);
    return { ...ctx, service };
  };

  it('happy path: creates user + verification token, sends mail, sets cookie, rotates CSRF, audits success', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();

    mocks.user.findByEmail.mockResolvedValue(null);
    mocks.user.isDisposableEmail.mockResolvedValue(false);
    mocks.password.hash.mockResolvedValue('hashed-pw');
    const created = userFixture({
      id: 'u-2',
      email: 'newuser@example.com',
      emailVerified: false,
      role: 'ADMIN',
      tenantId: 't-2',
    });
    const rawVerificationToken = 'a'.repeat(64);
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-2', name: 'newuser', slug: 'newuser-abcd1234' });
    tx.user.create.mockResolvedValue(created);
    mocks.token.createVerificationToken.mockResolvedValue(rawVerificationToken);

    const result = await service.register(baseInput, '127.0.0.1', 'jest-ua', req, res);

    // The profile is projected from the row created in the transaction: no
    // second SELECT (getProfile), and no credential field may leak into the
    // response (mirrors login.service.ts).
    const profile = userProfileFixture({ id: 'u-2', email: 'newuser@example.com', role: 'ADMIN' });
    expect(result).toEqual({ user: profile, requiresVerification: true, emailSent: true });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(mocks.user.getProfile).not.toHaveBeenCalled();
    expect(mocks.shared.validateTurnstile).toHaveBeenCalledWith('turnstile-ok', '127.0.0.1');
    expect(mocks.password.hash).toHaveBeenCalledWith(baseInput.password);
    // Self-signup provisions a new organization (Tenant), owned by the new ADMIN user.
    expect(tx.tenant.create).toHaveBeenCalledTimes(1);
    // Email normalized to lowercase + trimmed; owner is ADMIN of the new tenant.
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'newuser@example.com',
          passwordHash: 'hashed-pw',
          displayName: 'New User',
          role: 'ADMIN',
          tenantId: 't-2',
        }),
      }),
    );
    // The owner's ADMIN permissions come from the global seeded role-level grant
    // (role: ADMIN, userId: null), NOT per-user rows - so a later downgrade to
    // USER fully removes them. Registration must NOT mint per-user permission
    // rows (regression guard for the survive-downgrade privilege bug).
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
    // Token creation goes through the ONE shared TokenService path (which
    // deletes previous tokens, hashes, and applies the TTL - covered by
    // token.service.spec) and runs on the SAME tx as the user create.
    expect(mocks.token.createVerificationToken).toHaveBeenCalledWith('u-2', tx);
    expect(mocks.mail.sendVerificationEmail).toHaveBeenCalledWith(
      'newuser@example.com',
      expect.stringContaining(`/auth/verify-email?token=${rawVerificationToken}`),
    );
    // establishSession owns create-session + cookie + CSRF rotation; the
    // owner's session carries the new tenant id.
    expect(mocks.shared.establishSession).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({ userId: 'u-2', rememberMe: false, tenantId: 't-2' }),
    );
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.AUTH_REGISTER_SUCCESS,
        userId: 'u-2',
        // Audit runs before AuthMiddleware sets the ALS tenant, so the new
        // owner's tenant id is passed explicitly.
        tenantId: 't-2',
        targetType: 'User',
        targetId: 'u-2',
      }),
    );
  });

  it('throws FORBIDDEN/TURNSTILE_FAILED when Turnstile rejects', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.shared.validateTurnstile.mockRejectedValue(
      new TRPCError({ code: 'FORBIDDEN', message: AppErrorCode.TURNSTILE_FAILED }),
    );

    await expect(service.register(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: AppErrorCode.TURNSTILE_FAILED,
    });
    expect(mocks.user.findByEmail).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN/DISPOSABLE_EMAIL when email is disposable', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.isDisposableEmail.mockResolvedValue(true);

    await expect(service.register(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: AppErrorCode.DISPOSABLE_EMAIL,
    });
    expect(mocks.user.findByEmail).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST/EMAIL_IN_USE when email already exists', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findByEmail.mockResolvedValue(userFixture());

    await expect(service.register(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: AppErrorCode.EMAIL_IN_USE,
    });
    expect(mocks.password.hash).not.toHaveBeenCalled();
    expect(mocks.prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('maps a P2002 from the transaction to the clean EMAIL_IN_USE error, not a raw 500', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    // Pre-check passes (email looks free), but a concurrent double-submit trips
    // the User.email unique constraint inside the tx -> Prisma P2002.
    mocks.user.findByEmail.mockResolvedValue(null);
    mocks.password.hash.mockResolvedValue('hashed-pw');
    mocks.prisma.client.$transaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      }),
    );

    await expect(service.register(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: AppErrorCode.EMAIL_IN_USE,
    });
    // No post-transaction side effects ran (mail / session / audit).
    expect(mocks.mail.sendVerificationEmail).not.toHaveBeenCalled();
    expect(mocks.shared.establishSession).not.toHaveBeenCalled();
    expect(mocks.audit.log).not.toHaveBeenCalled();
  });

  it('rethrows a P2002 slug-constraint collision rather than mislabeling it EMAIL_IN_USE', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findByEmail.mockResolvedValue(null);
    mocks.password.hash.mockResolvedValue('hashed-pw');
    // The tx ALSO writes Tenant.slug (@unique). A slug collision is a P2002 whose
    // target is the slug constraint, not email - it must surface as the original
    // (unexpected internal) error, not the user-facing EMAIL_IN_USE.
    mocks.prisma.client.$transaction.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`slug`)'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: { target: ['slug'] },
      }),
    );

    const err = await service
      .register(baseInput, '1.2.3.4', 'ua', req, res)
      .then(() => null)
      .catch((e: unknown) => e as { message?: string });

    expect(err).not.toBeNull();
    expect(err?.message).not.toBe(AppErrorCode.EMAIL_IN_USE);
    expect(err?.message).toMatch(/Unique constraint failed/);
  });

  it('rethrows a non-P2002 transaction error unchanged (not masked as EMAIL_IN_USE)', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findByEmail.mockResolvedValue(null);
    mocks.password.hash.mockResolvedValue('hashed-pw');
    mocks.prisma.client.$transaction.mockRejectedValue(new Error('DB connection lost'));

    await expect(service.register(baseInput, '1.2.3.4', 'ua', req, res)).rejects.toThrow(
      'DB connection lost',
    );
  });

  it('still resolves with emailSent: false when the verification-email enqueue rejects', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findByEmail.mockResolvedValue(null);
    mocks.password.hash.mockResolvedValue('hashed-pw');
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-3', name: 'newuser', slug: 'newuser-x' });
    tx.user.create.mockResolvedValue(userFixture({ id: 'u-3', role: 'ADMIN', tenantId: 't-3' }));
    tx.permission.findMany.mockResolvedValue([]);
    tx.rolePermission.createMany.mockResolvedValue({ count: 0 });
    mocks.token.createVerificationToken.mockResolvedValue('b'.repeat(64));
    mocks.mail.sendVerificationEmail.mockRejectedValue(new Error('enqueue failed'));

    await expect(service.register(baseInput, '1.2.3.4', 'ua', req, res)).resolves.toMatchObject({
      requiresVerification: true,
      // The enqueue failure is reported, not swallowed: the client can offer
      // the resend CTA instead of waiting for mail that never comes.
      emailSent: false,
    });
    // Audit still logged even when mail fails.
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_REGISTER_SUCCESS }),
    );
  });

  it('passes displayName: null when input.displayName is undefined', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findByEmail.mockResolvedValue(null);
    mocks.password.hash.mockResolvedValue('h');
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-1', name: 'newuser', slug: 'newuser-x' });
    tx.user.create.mockResolvedValue(userFixture({ role: 'ADMIN', tenantId: 't-1' }));
    tx.permission.findMany.mockResolvedValue([]);
    tx.rolePermission.createMany.mockResolvedValue({ count: 0 });
    mocks.token.createVerificationToken.mockResolvedValue('c'.repeat(64));

    await service.register({ ...baseInput, displayName: undefined }, '1.2.3.4', 'ua', req, res);

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: null }) }),
    );
  });

  it('puts the raw TokenService token in the email URL, minted on the registration tx', async () => {
    const { service, mocks } = await buildCtx();
    const { req, res } = expressMocks();
    mocks.user.findByEmail.mockResolvedValue(null);
    mocks.password.hash.mockResolvedValue('h');
    const tx = mockPrismaTransaction(mocks.prisma, buildPrismaTx());
    tx.tenant.create.mockResolvedValue({ id: 't-9', name: 'newuser', slug: 'newuser-x' });
    tx.user.create.mockResolvedValue(userFixture({ id: 'u-9', role: 'ADMIN', tenantId: 't-9' }));
    tx.permission.findMany.mockResolvedValue([]);
    tx.rolePermission.createMany.mockResolvedValue({ count: 0 });
    const rawToken = 'd'.repeat(64);
    mocks.token.createVerificationToken.mockResolvedValue(rawToken);

    await service.register(baseInput, '1.2.3.4', 'ua', req, res);

    // Minted through the shared TokenService path (hashing/TTL covered by
    // token.service.spec) on the SAME tx as the user create.
    expect(mocks.token.createVerificationToken).toHaveBeenCalledWith('u-9', tx);
    const mailCall = mocks.mail.sendVerificationEmail.mock.calls[0];
    const verificationUrl = mailCall[1] as string;
    const rawTokenInUrl = new URL(verificationUrl).searchParams.get('token');
    expect(rawTokenInUrl).toBe(rawToken);
  });
});
