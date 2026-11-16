import { describe, expect, it } from 'vitest';
import {
  renderVerificationEmail,
  renderPasswordResetEmail,
  renderWelcomeEmail,
  renderPasswordChangedEmail,
  renderTwoFactorEnabledEmail,
  renderEmailChangeVerificationEmail,
  renderEmailChangeRequestedEmail,
  renderStaffInviteEmail,
  renderStaffInviteJoinAndCloseEmail,
} from './index.js';

const appName = 'SaaS Starter';

/**
 * Smoke test: every template renders to non-empty HTML that includes the app
 * name. Catches render-time breakage (a throwing template, a bad prop) that a
 * type-check alone would miss, before a broken template ships.
 */
describe('email templates render', () => {
  it('verification', async () => {
    const html = await renderVerificationEmail({ verificationUrl: 'https://x/verify', appName });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(appName);
    // Default expiry copy matches the shared VERIFICATION_TOKEN_TTL_MS (24h).
    expect(html).toMatch(/This link expires in (?:<!-- -->)?24 hours/);
    // The owner of an address somebody else registered is told to
    // ignore the mail rather than click through.
    expect(html).toMatch(/Didn&#x27;t create a (?:<!-- -->)?SaaS Starter(?:<!-- -->)? account\?/);
    expect(html).toContain('the address stays unverified');
  });

  it('verification renders a caller-supplied expiry duration', async () => {
    const html = await renderVerificationEmail({
      verificationUrl: 'https://x/verify',
      appName,
      expiresIn: '48 hours',
    });
    expect(html).toMatch(/This link expires in (?:<!-- -->)?48 hours/);
  });

  it('password reset', async () => {
    const html = await renderPasswordResetEmail({
      resetUrl: 'https://x/reset',
      ipAddress: '203.0.113.5',
      appName,
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(appName);
    // Default expiry copy matches the shared PASSWORD_RESET_TOKEN_TTL_MS (1h).
    expect(html).toMatch(/This link expires in (?:<!-- -->)?1 hour/);
  });

  it('password reset renders a caller-supplied expiry duration', async () => {
    const html = await renderPasswordResetEmail({
      resetUrl: 'https://x/reset',
      ipAddress: '203.0.113.5',
      appName,
      expiresIn: '2 hours',
    });
    expect(html).toMatch(/This link expires in (?:<!-- -->)?2 hours/);
  });

  it('welcome', async () => {
    const html = await renderWelcomeEmail({ loginUrl: 'https://x/login', appName });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(appName);
  });

  it('password changed', async () => {
    const html = await renderPasswordChangedEmail({ appName });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(appName);
  });

  it('two-factor enabled', async () => {
    const html = await renderTwoFactorEnabledEmail({
      appName,
      settingsUrl: 'https://x/settings',
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(appName);
    expect(html).toContain('https://x/settings');
  });

  it('email change verification (to the new address)', async () => {
    const html = await renderEmailChangeVerificationEmail({
      confirmUrl: 'https://x/auth/confirm-email-change?token=t',
      appName,
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(appName);
    expect(html).toContain('https://x/auth/confirm-email-change?token=t');
    // Default expiry copy matches the shared EMAIL_CHANGE_TOKEN_TTL_MS (1h).
    expect(html).toMatch(/This link expires in (?:<!-- -->)?1 hour/);
  });

  it('email change verification renders a caller-supplied expiry duration', async () => {
    const html = await renderEmailChangeVerificationEmail({
      confirmUrl: 'https://x/confirm',
      appName,
      expiresIn: '2 hours',
    });
    expect(html).toMatch(/This link expires in (?:<!-- -->)?2 hours/);
  });

  it('email change requested (tripwire to the old address)', async () => {
    const html = await renderEmailChangeRequestedEmail({
      appName,
      newEmail: 'new@example.com',
      settingsUrl: 'https://x/settings',
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(appName);
    expect(html).toContain('new@example.com');
    expect(html).toContain('https://x/settings');
  });

  it('staff invite names the organization and the inviter', async () => {
    const html = await renderStaffInviteEmail({
      inviteUrl: 'https://x/auth/invite/tok',
      appName,
      organizationName: 'Acme Consulting',
      inviterName: 'Jane Doe',
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('Acme Consulting');
    expect(html).toContain('Jane Doe');
    expect(html).toMatch(/expires in (?:<!-- -->)?7 days/);
  });

  it('staff invite still reads correctly with no inviter name', async () => {
    // An organization account need not have a display name, so the unnamed branch is a
    // real population rather than a defensive default.
    const html = await renderStaffInviteEmail({
      inviteUrl: 'https://x/auth/invite/tok',
      appName,
      organizationName: 'Acme Consulting',
    });
    expect(html).toContain('You have been invited to join');
    expect(html).toContain('Acme Consulting');
  });

  it('staff invite renders a caller-supplied expiry duration', async () => {
    const html = await renderStaffInviteEmail({
      inviteUrl: 'https://x/auth/invite/tok',
      appName,
      organizationName: 'Acme Consulting',
      expiresIn: '1 day',
    });
    expect(html).toMatch(/expires in (?:<!-- -->)?1 day\b/);
  });

  it('the collision invite states the consequence BEFORE the button', async () => {
    // The whole reason this template exists. Accepting moves the account into
    // another organization and closes the reader's current organization; a consequence
    // disclosed after the call to action is not disclosed, so the warning has to
    // come first in the document order too.
    const html = await renderStaffInviteJoinAndCloseEmail({
      inviteUrl: 'https://x/auth/invite/tok',
      appName,
      organizationName: 'Acme Consulting',
      inviterName: 'Jane Doe',
    });
    const warningAt = html.indexOf('closes the organization you are in now');
    const buttonAt = html.indexOf('https://x/auth/invite/tok');
    expect(warningAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(-1);
    expect(warningAt).toBeLessThan(buttonAt);
  });

  it('the collision invite says the move cannot be undone, and that ignoring it is safe', async () => {
    const html = await renderStaffInviteJoinAndCloseEmail({
      inviteUrl: 'https://x/auth/invite/tok',
      appName,
      organizationName: 'Acme Consulting',
    });
    expect(html).toContain('moves your account into');
    expect(html).toContain('You cannot undo');
    expect(html).toContain('nothing changes until you click');
  });

  it('the collision invite discloses nothing about the organization being closed', async () => {
    // It may say THAT the current organization closes. It must not say what is in it,
    // whether it is empty, or who else is there: the reader has proved nothing
    // yet, and a mail is not a place to answer that.
    const html = await renderStaffInviteJoinAndCloseEmail({
      inviteUrl: 'https://x/auth/invite/tok',
      appName,
      organizationName: 'Acme Consulting',
    });
    expect(html).not.toContain('empty');
    expect(html).not.toContain('nobody else');
  });
});

/*
 * The document language and the footer are part of the message, not chrome:
 * `<html lang>` decides the voice a screen reader reads the email in, and the
 * footer must be in the same language as the body. The invites are pinned here
 * because they carry the most copy of their own.
 */
describe('layout language', () => {
  const inviteRenders: readonly [string, () => Promise<string>][] = [
    [
      'staff invite',
      () =>
        renderStaffInviteEmail({
          inviteUrl: 'https://x/auth/invite/tok',
          appName,
          organizationName: 'Acme Consulting',
        }),
    ],
    [
      'staff invite (join and close)',
      () =>
        renderStaffInviteJoinAndCloseEmail({
          inviteUrl: 'https://x/auth/invite/tok',
          appName,
          organizationName: 'Acme Consulting',
        }),
    ],
  ];

  it.each(inviteRenders)(
    '%s declares lang="en" and the English footer',
    async (_name, renderIt) => {
      const html = await renderIt();
      expect(html).toContain('lang="en"');
      expect(html).toContain('This email was sent by');
    },
  );

  it('the English templates keep lang="en" and the English footer', async () => {
    const html = await renderWelcomeEmail({ appName, loginUrl: 'https://x/auth/login' });
    expect(html).toContain('lang="en"');
    expect(html).toContain('This email was sent by');
  });
});
