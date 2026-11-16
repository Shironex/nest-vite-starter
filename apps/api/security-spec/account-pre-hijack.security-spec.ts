/**
 * SEC-002: account pre-hijacking. An attacker registers the
 * victim's address with their own password and keeps the session registration
 * opens. The victim later clicks the verification mail and signs in with
 * Google. Before the fix the Google sign-in auto-linked into the account whose
 * password the attacker still knew, and the attacker's pre-verification session
 * survived the verification.
 *
 * Fixed by never auto-linking a Google sign-in into a password account and by
 * revoking every session when an email address is verified.
 *
 * Scope here is the link half, which is the door: a password on the account is
 * the gate, and it holds whatever else is true of the account. The session half
 * of the chain (the pre-verification session no longer validating, epoch fence
 * included) is pinned against a real SessionService by
 * `src/modules/auth/account-pre-hijack.isolation.spec.ts` in the isolation
 * lane, and is referenced rather than duplicated here.
 */
import { OAUTH_ERROR_CODES } from '@/modules/auth/oauth/oauth.constants';
import { closeWorld, openWorld, type ISecurityWorld } from './fixtures';
import { buildOAuthDoor, failureReasons, googleIdentity, OAUTH_CTX } from './oauth-door';

let world: ISecurityWorld;

beforeAll(async () => {
  world = await openWorld('sec-002');
});

afterAll(closeWorld);

describe('SEC-002 a password account never gains a Google link from a login', () => {
  it('control: a passwordless, factorless, double-verified account is auto-linked', async () => {
    // The auto-link that remains. Without this case the refusals below would
    // also pass against a service that refused every auto-link, which would be
    // a different product, not a fix.
    const tenant = await world.makeTenant('passwordless');
    const member = await world.makeUser(tenant.id, { passwordHash: null });
    const { service, sessionRevocation } = buildOAuthDoor(world.prismaService);

    await expect(
      service.resolveLogin(googleIdentity(member.email, `sec-002-ok-${member.id}`), OAUTH_CTX),
    ).resolves.toMatchObject({ outcome: 'authenticated', user: { id: member.id } });
    expect(await world.unscoped.oAuthAccount.count({ where: { userId: member.id } })).toBe(1);
    // A new sign-in method just attached itself, so earlier sessions go.
    expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith(member.id);
  });

  it('refuses the pre-hijacked account: LINK_BLOCKED, no link row, no session', async () => {
    // Exactly the attacker's shape: a password chosen before anyone proved
    // control of the inbox, and an address the victim has since verified.
    const tenant = await world.makeTenant('pre-hijacked');
    const victim = await world.makeUser(tenant.id, { emailVerified: true });
    const { service, audit, sessionRevocation } = buildOAuthDoor(world.prismaService);

    await expect(
      service.resolveLogin(googleIdentity(victim.email, `sec-002-atk-${victim.id}`), OAUTH_CTX),
    ).resolves.toEqual({
      outcome: 'rejected',
      errorCode: OAUTH_ERROR_CODES.LINK_BLOCKED,
    });
    expect(failureReasons(audit)).toEqual(['link_blocked_password_account']);
    expect(await world.unscoped.oAuthAccount.count({ where: { userId: victim.id } })).toBe(0);
    expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
  });

  it('refuses while the address is still unverified on our side, without an oracle', async () => {
    // The unverified account is refused too, and with the same generic code the
    // rest of the surface uses, so the answer does not say whether an account
    // with that address exists.
    const tenant = await world.makeTenant('unverified');
    const victim = await world.makeUser(tenant.id, { emailVerified: false });
    const { service } = buildOAuthDoor(world.prismaService);

    await expect(
      service.resolveLogin(googleIdentity(victim.email, `sec-002-unv-${victim.id}`), OAUTH_CTX),
    ).resolves.toEqual({
      outcome: 'rejected',
      errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS,
    });
    expect(await world.unscoped.oAuthAccount.count({ where: { userId: victim.id } })).toBe(0);
  });
});
