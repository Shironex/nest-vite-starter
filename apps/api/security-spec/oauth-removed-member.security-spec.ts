/**
 * SEC-001: a member removed from their organization must not sign back in with
 * Google. The password door checks `membershipEndedAt`; the provider door has
 * to as well, because removal leaves the row, its tenantId, its role and every
 * OAuthAccount link exactly where they were.
 *
 * The fix refuses a removed member at the Google sign-in door, closes the same
 * hole at the session seam, and makes the removal itself retryable.
 *
 * Scope here is the door only: `resolveLogin` refuses on both of its branches.
 * The wider surface (the seam re-reading account state, the other auto-link
 * gates, the retryable removal) is pinned by
 * `src/modules/auth/oauth/oauth-removed-member.isolation.spec.ts` in the
 * isolation lane. This file does not duplicate it: it is the case that must
 * never go quiet, reconciled by name against findings.json.
 */
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { now } from '@/common/clock/clock';
import { OAUTH_ERROR_CODES } from '@/modules/auth/oauth/oauth.constants';
import type { IOAuthIdentity } from '@/modules/auth/oauth/providers/oauth-provider.interface';
import { UserRepository } from '@/modules/user/user.repository';
import { closeWorld, openWorld, type ISecurityWorld, type ISeededUser } from './fixtures';
import { buildOAuthDoor, failureReasons, googleIdentity, OAUTH_CTX } from './oauth-door';

let world: ISecurityWorld;
let users: UserRepository;

/** A Google link row for an existing member, as the callback would have written it. */
const linkGoogle = async (user: ISeededUser): Promise<IOAuthIdentity> => {
  const subject = `sec-001-${user.id}`;
  await world.unscoped.oAuthAccount.create({
    data: {
      provider: 'google',
      providerAccountId: subject,
      email: user.email,
      emailVerified: true,
      userId: user.id,
    },
  });
  return googleIdentity(user.email, subject);
};

/** The admin's removal, through the real guarded write. */
const removeFromOrganization = async (user: ISeededUser, tenantId: string): Promise<void> => {
  expect(await users.endMembership(user.id, tenantId, now())).toBe(1);
};

beforeAll(async () => {
  world = await openWorld('sec-001');
  users = new UserRepository(world.prismaService);
});

afterAll(closeWorld);

describe('SEC-001 the Google door refuses a removed member', () => {
  it('control: an active member with a linked Google account is authenticated', async () => {
    const tenant = await world.makeTenant('active');
    const member = await world.makeUser(tenant.id);
    const identity = await linkGoogle(member);
    const { service } = buildOAuthDoor(world.prismaService);

    await expect(service.resolveLogin(identity, OAUTH_CTX)).resolves.toMatchObject({
      outcome: 'authenticated',
      user: { id: member.id, tenantId: tenant.id },
    });
  });

  it('refuses the removed member on the linked path and audits membership_ended', async () => {
    const tenant = await world.makeTenant('linked');
    const member = await world.makeUser(tenant.id);
    const identity = await linkGoogle(member);
    await removeFromOrganization(member, tenant.id);
    const { service, audit } = buildOAuthDoor(world.prismaService);

    await expect(service.resolveLogin(identity, OAUTH_CTX)).resolves.toEqual({
      outcome: 'rejected',
      errorCode: OAUTH_ERROR_CODES.FAILED,
    });
    expect(failureReasons(audit)).toEqual(['membership_ended']);
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.OAUTH_LOGIN }),
    );
  });

  it('refuses the removed member on the auto-link path and writes no link row', async () => {
    // Passwordless and double-verified: everything the auto-link needs except a
    // live membership, so the membership check is the only thing refusing here.
    const tenant = await world.makeTenant('autolink');
    const member = await world.makeUser(tenant.id, { passwordHash: null });
    await removeFromOrganization(member, tenant.id);
    const { service, audit } = buildOAuthDoor(world.prismaService);

    await expect(
      service.resolveLogin(googleIdentity(member.email, `sec-001-new-${member.id}`), OAUTH_CTX),
    ).resolves.toEqual({ outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED });
    expect(failureReasons(audit)).toEqual(['membership_ended']);
    expect(await world.unscoped.oAuthAccount.count({ where: { userId: member.id } })).toBe(0);
  });
});
