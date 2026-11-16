import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { createAuthTestModule, type AuthMocksOverrides } from '@test/test-module';
import { userFixture } from '@test/fixtures';
import { ProvisioningService } from '../services/provisioning.service';
import { OAuthAccountService } from './oauth-account.service';
import { OAUTH_ERROR_CODES } from './oauth.constants';
import type { IOAuthIdentity } from './providers/oauth-provider.interface';

const identityFixture = (overrides: Partial<IOAuthIdentity> = {}): IOAuthIdentity => ({
  provider: 'google',
  subject: 'sub-123',
  email: 'user@example.com',
  emailVerified: true,
  displayName: 'Test User',
  avatarUrl: 'https://lh3.example/avatar',
  ...overrides,
});

const ctxFixture = { ip: '203.0.113.9', userAgent: 'ua' };

/** The resolution projection (never the full credential row). */
const resolutionUser = (overrides: Partial<ReturnType<typeof userFixture>> = {}) => {
  const u = userFixture({ emailVerified: true, tenantId: 't-1', ...overrides });
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    emailVerified: u.emailVerified,
    tenantId: u.tenantId,
    deletedAt: u.deletedAt,
    lockedUntil: u.lockedUntil,
    membershipEndedAt: u.membershipEndedAt,
  };
};

/** When the member was removed from their organization, for the membership_ended cases. */
const REMOVED_AT = new Date('2026-09-01T09:00:00Z');

describe('OAuthAccountService', () => {
  const provisioningMock = () => ({ provisionOrganizationForOAuthSignup: jest.fn() });

  const buildCtx = async (
    options: { overrides?: AuthMocksOverrides; allowSignup?: boolean } = {},
  ) => {
    const provisioning = provisioningMock();
    const ctx = await createAuthTestModule({
      overrides: {
        ...(options.overrides ?? {}),
        ...(options.allowSignup === false
          ? {
              config: {
                get: jest.fn((key: string) =>
                  key === 'OAUTH_ALLOW_SIGNUP' ? false : key === 'NODE_ENV' ? 'test' : undefined,
                ),
              },
            }
          : {}),
      },
      providers: [
        // Last-wins override: the real ProvisioningService from the harness is
        // replaced so these specs assert the call contract, not the tx internals
        // (provisioning.service.spec.ts owns those).
        { provide: ProvisioningService, useValue: provisioning },
        OAuthAccountService,
      ],
    });
    return { ...ctx, provisioning, service: ctx.get(OAuthAccountService) };
  };

  describe('resolveLogin(): linked-account branch', () => {
    it('logs in a healthy linked user: epoch first, snapshot refreshed, oauth.login audited', async () => {
      const { service, mocks } = await buildCtx();
      const user = resolutionUser({ id: 'u-1' });
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue({
        id: 'oa-1',
        userId: 'u-1',
        user,
      });
      const order: string[] = [];
      mocks.session.readEpoch.mockImplementation(async () => {
        order.push('readEpoch');
        return 7;
      });
      mocks.prisma.client.oAuthAccount.update.mockImplementation(async () => {
        order.push('update');
        return {};
      });

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({
        outcome: 'authenticated',
        user: {
          id: 'u-1',
          email: user.email,
          role: 'USER',
          emailVerified: true,
          tenantId: 't-1',
        },
        epoch: 7,
      });
      // The fence: the epoch is captured immediately after the link row (the
      // credential) is read, BEFORE the snapshot write and the audit.
      expect(order).toEqual(['readEpoch', 'update']);
      expect(mocks.session.readEpoch).toHaveBeenCalledWith('u-1');
      // Identity is (provider, sub); the email is never a lookup key here.
      expect(mocks.prisma.client.oAuthAccount.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_providerAccountId: { provider: 'google', providerAccountId: 'sub-123' },
          },
        }),
      );
      // Snapshot drift: the row's email copy refreshes; User.email is untouched.
      expect(mocks.prisma.client.oAuthAccount.update).toHaveBeenCalledWith({
        where: { id: 'oa-1' },
        data: { email: 'user@example.com' },
      });
      expect(mocks.prisma.client.user.update).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_LOGIN,
          userId: 'u-1',
          tenantId: 't-1',
          metadata: { provider: 'google', providerAccountId: 'sub-123' },
        }),
      );
    });

    it('rejects a soft-deleted linked user with the generic code (restore-or-reject parity)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue({
        id: 'oa-1',
        userId: 'u-1',
        user: resolutionUser({ id: 'u-1', deletedAt: new Date('2026-01-02T00:00:00Z') }),
      });

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED });
      expect(mocks.prisma.client.oAuthAccount.update).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_FAILURE,
          success: false,
          userId: 'u-1',
          metadata: expect.objectContaining({ reason: 'account_deleted' }),
        }),
      );
    });

    it('rejects a locked linked user and never touches the lockout counters', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue({
        id: 'oa-1',
        userId: 'u-1',
        user: resolutionUser({ id: 'u-1', lockedUntil: new Date(Date.now() + 60_000) }),
      });
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: true });

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED });
      // OAuth failures are not password guesses.
      expect(mocks.lockout.recordFailedAttempt).not.toHaveBeenCalled();
      expect(mocks.lockout.resetAttempts).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_FAILURE,
          metadata: expect.objectContaining({ reason: 'account_locked' }),
        }),
      );
    });

    it('rejects a linked member removed from their organization: generic code, membership_ended audited', async () => {
      // Removal keeps the row, its tenantId, its role and the link row, so
      // without this refusal the link alone signs them back into that organization.
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue({
        id: 'oa-1',
        userId: 'u-1',
        user: resolutionUser({ id: 'u-1', membershipEndedAt: REMOVED_AT }),
      });

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED });
      expect(mocks.prisma.client.oAuthAccount.update).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledTimes(1);
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_FAILURE,
          success: false,
          userId: 'u-1',
          tenantId: 't-1',
          metadata: expect.objectContaining({ reason: 'membership_ended' }),
        }),
      );
    });
  });

  describe('resolveLogin(): email-conflict (auto-link) branch', () => {
    const noLink = (mocks: { prisma: { client: { oAuthAccount: { findUnique: jest.Mock } } } }) =>
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue(null);

    it('auto-links a double-verified zero-factor passwordless user: row created, tripwire sent, oauth.link audited', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      const user = resolutionUser({ id: 'u-2' });
      mocks.prisma.client.user.findFirst.mockResolvedValue(user);
      mocks.prisma.client.user.count.mockResolvedValue(0);
      mocks.session.readEpoch.mockResolvedValue(3);
      mocks.prisma.client.oAuthAccount.create.mockResolvedValue({ id: 'oa-new' });

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({
        outcome: 'authenticated',
        user: expect.objectContaining({ id: 'u-2', tenantId: 't-1' }),
        // The pre-check capture plus the one bump the auto-link's own
        // revocation makes (see the revocation case below).
        epoch: 4,
      });
      expect(mocks.secondFactor.findAnyActive).toHaveBeenCalledWith('u-2');
      // The password probe counts; it never loads the hash.
      expect(mocks.prisma.client.user.count).toHaveBeenCalledWith({
        where: { id: 'u-2', deletedAt: null, passwordHash: { not: null } },
      });
      expect(mocks.prisma.client.oAuthAccount.create).toHaveBeenCalledWith({
        data: {
          provider: 'google',
          providerAccountId: 'sub-123',
          email: 'user@example.com',
          emailVerified: true,
          userId: 'u-2',
        },
      });
      expect(mocks.mail.sendOAuthAccountLinkedEmail).toHaveBeenCalledWith(user.email, 'Google');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_LINK,
          userId: 'u-2',
          tenantId: 't-1',
          metadata: expect.objectContaining({ auto: true }),
        }),
      );
    });

    it('refuses the auto-link when ANY active second factor exists (zero-factors gate)', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-2' }));
      mocks.secondFactor.findAnyActive.mockResolvedValue({ id: 'sf-1', type: 'RECOVERY_CODE' });

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.LINK_BLOCKED });
      expect(mocks.prisma.client.oAuthAccount.create).not.toHaveBeenCalled();
      expect(mocks.mail.sendOAuthAccountLinkedEmail).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_FAILURE,
          metadata: expect.objectContaining({ reason: 'link_blocked_second_factor' }),
        }),
      );
    });

    it('refuses the auto-link for an account with a password (account pre-hijacking): LINK_BLOCKED, no row', async () => {
      // An attacker can register the victim's address with their own password;
      // once the victim verifies it, auto-linking Google would hand the victim
      // an account whose password the attacker still knows.
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-2' }));
      mocks.prisma.client.user.count.mockResolvedValue(1);

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.LINK_BLOCKED });
      expect(mocks.prisma.client.oAuthAccount.create).not.toHaveBeenCalled();
      expect(mocks.mail.sendOAuthAccountLinkedEmail).not.toHaveBeenCalled();
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledTimes(1);
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_FAILURE,
          success: false,
          userId: 'u-2',
          tenantId: 't-1',
          metadata: expect.objectContaining({ reason: 'link_blocked_password_account' }),
        }),
      );
    });

    it('keeps the factor reason when an account has both a factor and a password', async () => {
      // The factor gate runs first, unchanged; the password gate never runs.
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-2' }));
      mocks.secondFactor.findAnyActive.mockResolvedValue({ id: 'sf-1', type: 'TOTP' });
      mocks.prisma.client.user.count.mockResolvedValue(1);

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.LINK_BLOCKED });
      expect(mocks.prisma.client.user.count).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'link_blocked_second_factor' }),
        }),
      );
    });

    it('answers an UNVERIFIED identity for a password account exactly as before (no new oracle)', async () => {
      // The password gate sits inside the double-verified arm, so an
      // unverified claim learns nothing about whether the account has one.
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-2' }));
      mocks.prisma.client.user.count.mockResolvedValue(1);

      const result = await service.resolveLogin(
        identityFixture({ emailVerified: false }),
        ctxFixture,
      );

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
      expect(mocks.prisma.client.user.count).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'identity_email_unverified' }),
        }),
      );
    });

    it('revokes every earlier session after writing the link, and hands the seam capture + 1', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-2' }));
      mocks.prisma.client.user.count.mockResolvedValue(0);
      const order: string[] = [];
      mocks.session.readEpoch.mockImplementation(async () => {
        order.push('readEpoch');
        return 9;
      });
      mocks.prisma.client.oAuthAccount.create.mockImplementation(async () => {
        order.push('create');
        return { id: 'oa-new' };
      });
      mocks.sessionRevocation.revokeAllAndDisconnect.mockImplementation(async () => {
        order.push('revoke');
      });

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(mocks.sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-2');
      // Captured once, before the gates; the revocation follows the committed
      // link row. Re-reading after the revoke would absorb a concurrent
      // revocation (a member removal) and mint straight through it.
      expect(order).toEqual(['readEpoch', 'create', 'revoke']);
      expect(result).toEqual(expect.objectContaining({ outcome: 'authenticated', epoch: 10 }));
    });

    it('gates on the ANY-active check, not the non-recovery one the challenge uses', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-2' }));
      // A recovery-only account: invisible to findActiveNonRecovery, but still
      // a 2FA-protected account for linking purposes.
      mocks.secondFactor.findAnyActive.mockResolvedValue({ id: 'sf-1', type: 'RECOVERY_CODE' });
      mocks.secondFactor.findActiveNonRecovery.mockResolvedValue(null);

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.LINK_BLOCKED });
    });

    it('rejects with account_exists when the PROVIDER email is unverified', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser());

      const result = await service.resolveLogin(
        identityFixture({ emailVerified: false }),
        ctxFixture,
      );

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
      expect(mocks.prisma.client.oAuthAccount.create).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'identity_email_unverified' }),
        }),
      );
    });

    it('rejects with account_exists when the LOCAL email is unverified', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(
        resolutionUser({ emailVerified: false }),
      );

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'user_email_unverified' }),
        }),
      );
    });

    it('rejects a locked conflict account with account_exists, not a lockout oracle', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(
        resolutionUser({ lockedUntil: new Date(Date.now() + 60_000) }),
      );
      mocks.lockout.isLockedFromUser.mockReturnValue({ locked: true });

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
    });

    it('never auto-links a removed member: generic code, no link row, membership_ended audited', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(
        resolutionUser({ id: 'u-2', membershipEndedAt: REMOVED_AT }),
      );

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED });
      // Refused before the factor gate and the write: a removed member never
      // gains a sign-in method, and never hears about one by email either.
      expect(mocks.secondFactor.findAnyActive).not.toHaveBeenCalled();
      expect(mocks.prisma.client.oAuthAccount.create).not.toHaveBeenCalled();
      expect(mocks.mail.sendOAuthAccountLinkedEmail).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_FAILURE,
          userId: 'u-2',
          tenantId: 't-1',
          metadata: expect.objectContaining({ reason: 'membership_ended' }),
        }),
      );
    });

    it('answers an UNVERIFIED identity for a removed member exactly as for anyone else', async () => {
      // No oracle: somebody holding an unverified Google claim to the address
      // must not learn from the wire code that its owner has left the organization.
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(
        resolutionUser({ membershipEndedAt: REMOVED_AT }),
      );

      const result = await service.resolveLogin(
        identityFixture({ emailVerified: false }),
        ctxFixture,
      );

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
      expect(mocks.prisma.client.oAuthAccount.create).not.toHaveBeenCalled();
    });

    it('maps a concurrent-link P2002 on create to account_exists', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-2' }));
      mocks.prisma.client.oAuthAccount.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
      expect(mocks.mail.sendOAuthAccountLinkedEmail).not.toHaveBeenCalled();
      // No link was written, so nobody is logged out.
      expect(mocks.sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    it('still logs in when the tripwire enqueue fails (mail outage must not fail the link)', async () => {
      const { service, mocks } = await buildCtx();
      noLink(mocks);
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-2' }));
      mocks.prisma.client.oAuthAccount.create.mockResolvedValue({ id: 'oa-new' });
      mocks.mail.sendOAuthAccountLinkedEmail.mockRejectedValue(new Error('smtp down'));

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual(expect.objectContaining({ outcome: 'authenticated' }));
    });
  });

  describe('resolveLogin(): signup branch', () => {
    const noMatches = (mocks: {
      prisma: {
        client: { oAuthAccount: { findUnique: jest.Mock }; user: { findFirst: jest.Mock } };
      };
    }) => {
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue(null);
      mocks.prisma.client.user.findFirst.mockResolvedValue(null);
    };

    it('provisions an organization with the verified claims and audits oauth.signup with an explicit tenantId', async () => {
      const { service, mocks, provisioning } = await buildCtx();
      noMatches(mocks);
      provisioning.provisionOrganizationForOAuthSignup.mockResolvedValue(
        userFixture({
          id: 'u-new',
          email: 'user@example.com',
          passwordHash: null,
          emailVerified: true,
          role: 'ADMIN',
          tenantId: 't-new',
        }),
      );
      mocks.session.readEpoch.mockResolvedValue(0);

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(provisioning.provisionOrganizationForOAuthSignup).toHaveBeenCalledWith({
        normalizedEmail: 'user@example.com',
        displayName: 'Test User',
        avatarUrl: 'https://lh3.example/avatar',
        provider: 'google',
        providerAccountId: 'sub-123',
      });
      expect(result).toEqual({
        outcome: 'authenticated',
        user: {
          id: 'u-new',
          email: 'user@example.com',
          role: 'ADMIN',
          emailVerified: true,
          tenantId: 't-new',
        },
        epoch: 0,
      });
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_SIGNUP,
          userId: 'u-new',
          // Pre-ALS: the ALS fallback would stamp null without this.
          tenantId: 't-new',
          metadata: { provider: 'google', providerAccountId: 'sub-123' },
        }),
      );
    });

    it('rejects with oauth_signup_disabled when OAUTH_ALLOW_SIGNUP is off', async () => {
      const { service, mocks, provisioning } = await buildCtx({ allowSignup: false });
      noMatches(mocks);

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({
        outcome: 'rejected',
        errorCode: OAUTH_ERROR_CODES.SIGNUP_DISABLED,
      });
      expect(provisioning.provisionOrganizationForOAuthSignup).not.toHaveBeenCalled();
    });

    it('never provisions from an unverified claim: generic oauth_failed', async () => {
      const { service, mocks, provisioning } = await buildCtx();
      noMatches(mocks);

      const result = await service.resolveLogin(
        identityFixture({ emailVerified: false }),
        ctxFixture,
      );

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED });
      expect(provisioning.provisionOrganizationForOAuthSignup).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_FAILURE,
          metadata: expect.objectContaining({ reason: 'email_unverified' }),
        }),
      );
    });

    it('maps a provisioning P2002 email collision (concurrent or soft-deleted holder) to account_exists', async () => {
      const { service, mocks, provisioning } = await buildCtx();
      noMatches(mocks);
      provisioning.provisionOrganizationForOAuthSignup.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['email'] } }),
      );

      const result = await service.resolveLogin(identityFixture(), ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
    });

    it('rethrows a non-email P2002 (slug collision) rather than mislabeling it', async () => {
      const { service, mocks, provisioning } = await buildCtx();
      noMatches(mocks);
      provisioning.provisionOrganizationForOAuthSignup.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['slug'] } }),
      );

      await expect(service.resolveLogin(identityFixture(), ctxFixture)).rejects.toThrow('unique');
    });

    it('normalizes the claim email before every lookup and write', async () => {
      const { service, mocks, provisioning } = await buildCtx();
      noMatches(mocks);
      provisioning.provisionOrganizationForOAuthSignup.mockResolvedValue(
        userFixture({ id: 'u-new', passwordHash: null, tenantId: 't-new' }),
      );

      await service.resolveLogin(identityFixture({ email: '  MiXeD@Example.COM ' }), ctxFixture);

      expect(mocks.prisma.client.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ email: 'mixed@example.com' }),
        }),
      );
      expect(provisioning.provisionOrganizationForOAuthSignup).toHaveBeenCalledWith(
        expect.objectContaining({ normalizedEmail: 'mixed@example.com' }),
      );
    });
  });

  describe('completeLink()', () => {
    it('refuses when the flow was pinned to a different user than the current session', async () => {
      const { service, mocks } = await buildCtx();

      const result = await service.completeLink(
        identityFixture(),
        'u-owner',
        'u-other',
        ctxFixture,
      );

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED });
      expect(mocks.prisma.client.oAuthAccount.create).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_FAILURE,
          metadata: expect.objectContaining({ reason: 'link_session_mismatch' }),
        }),
      );
    });

    it('refuses when the flow carries no pinned user at all', async () => {
      const { service } = await buildCtx();

      const result = await service.completeLink(identityFixture(), undefined, 'u-1', ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED });
    });

    it('rejects with oauth_account_exists when the sub belongs to a DIFFERENT user', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-1' }));
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue({
        id: 'oa-x',
        userId: 'u-elsewhere',
      });

      const result = await service.completeLink(identityFixture(), 'u-1', 'u-1', ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
      expect(mocks.prisma.client.oAuthAccount.create).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'sub_linked_elsewhere' }),
        }),
      );
    });

    it('treats a row already linked to the SAME user as an idempotent success', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-1' }));
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue({ id: 'oa-x', userId: 'u-1' });

      const result = await service.completeLink(identityFixture(), 'u-1', 'u-1', ctxFixture);

      expect(result).toEqual({ outcome: 'linked' });
      // No duplicate row, no duplicate tripwire, no duplicate audit.
      expect(mocks.prisma.client.oAuthAccount.create).not.toHaveBeenCalled();
      expect(mocks.mail.sendOAuthAccountLinkedEmail).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('creates the row, sends the tripwire and audits oauth.link on the happy path', async () => {
      const { service, mocks } = await buildCtx();
      const user = resolutionUser({ id: 'u-1' });
      mocks.prisma.client.user.findFirst.mockResolvedValue(user);
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue(null);
      mocks.prisma.client.oAuthAccount.create.mockResolvedValue({ id: 'oa-new' });

      const result = await service.completeLink(identityFixture(), 'u-1', 'u-1', ctxFixture);

      expect(result).toEqual({ outcome: 'linked' });
      expect(mocks.prisma.client.oAuthAccount.create).toHaveBeenCalledWith({
        data: {
          provider: 'google',
          providerAccountId: 'sub-123',
          email: 'user@example.com',
          emailVerified: true,
          userId: 'u-1',
        },
      });
      expect(mocks.mail.sendOAuthAccountLinkedEmail).toHaveBeenCalledWith(user.email, 'Google');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_LINK,
          userId: 'u-1',
          tenantId: 't-1',
          metadata: expect.objectContaining({ auto: false }),
        }),
      );
    });

    it('maps a concurrent-completion P2002 to oauth_account_exists', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.user.findFirst.mockResolvedValue(resolutionUser({ id: 'u-1' }));
      mocks.prisma.client.oAuthAccount.findUnique.mockResolvedValue(null);
      mocks.prisma.client.oAuthAccount.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      const result = await service.completeLink(identityFixture(), 'u-1', 'u-1', ctxFixture);

      expect(result).toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS });
    });
  });

  describe('listAccounts()', () => {
    it('returns only the session user rows, oldest link first, in the panel projection', async () => {
      const { service, mocks } = await buildCtx();
      const rows = [
        {
          id: 'oa-1',
          provider: 'google',
          email: 'e@x.io',
          createdAt: new Date('2026-01-01'),
          lastUsedAt: new Date('2026-02-01'),
        },
      ];
      mocks.prisma.client.oAuthAccount.findMany.mockResolvedValue(rows);

      const result = await service.listAccounts('u-1');

      expect(result).toBe(rows);
      expect(mocks.prisma.client.oAuthAccount.findMany).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        select: { id: true, provider: true, email: true, createdAt: true, lastUsedAt: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('unlink()', () => {
    const txUser = (passwordHash: string | null) => ({ passwordHash });
    const account = (id: string) => ({ id, provider: 'google', providerAccountId: `sub-${id}` });

    it('deletes the row inside the transaction and audits oauth.unlink AFTER the commit', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.user.findFirst.mockResolvedValue(txUser('a-hash'));
      mocks.prisma.client.oAuthAccount.findMany.mockResolvedValue([account('oa-1')]);
      mocks.prisma.client.oAuthAccount.delete.mockResolvedValue({});

      await service.unlink('u-1', 'oa-1', ctxFixture);

      expect(mocks.prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(mocks.prisma.client.oAuthAccount.delete).toHaveBeenCalledWith({
        where: { id: 'oa-1' },
      });
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.OAUTH_UNLINK,
          userId: 'u-1',
          metadata: { provider: 'google', providerAccountId: 'sub-oa-1' },
        }),
      );
    });

    it('refuses to remove the LAST sign-in method of a passwordless account (invariant in tx)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.user.findFirst.mockResolvedValue(txUser(null));
      mocks.prisma.client.oAuthAccount.findMany.mockResolvedValue([account('oa-1')]);

      await expect(service.unlink('u-1', 'oa-1', ctxFixture)).rejects.toMatchObject({
        appCode: 'PASSWORD_NOT_SET',
      });
      expect(mocks.prisma.client.oAuthAccount.delete).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('allows a passwordless account to unlink while ANOTHER linked account remains', async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.user.findFirst.mockResolvedValue(txUser(null));
      mocks.prisma.client.oAuthAccount.findMany.mockResolvedValue([
        account('oa-1'),
        account('oa-2'),
      ]);
      mocks.prisma.client.oAuthAccount.delete.mockResolvedValue({});

      await service.unlink('u-1', 'oa-1', ctxFixture);

      expect(mocks.prisma.client.oAuthAccount.delete).toHaveBeenCalledWith({
        where: { id: 'oa-1' },
      });
    });

    it("404s an id that is not the session user's (indistinguishable from nonexistent)", async () => {
      const { service, mocks } = await buildCtx();
      mocks.prisma.client.user.findFirst.mockResolvedValue(txUser('a-hash'));
      mocks.prisma.client.oAuthAccount.findMany.mockResolvedValue([account('oa-mine')]);

      await expect(service.unlink('u-1', 'oa-someone-elses', ctxFixture)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mocks.prisma.client.oAuthAccount.delete).not.toHaveBeenCalled();
    });
  });
});
