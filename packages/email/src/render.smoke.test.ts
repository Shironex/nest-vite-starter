import { describe, expect, it } from 'vitest';
import {
  renderVerificationEmail,
  renderPasswordResetEmail,
  renderWelcomeEmail,
  renderPasswordChangedEmail,
  renderTwoFactorEnabledEmail,
  renderEmailChangeVerificationEmail,
  renderEmailChangeRequestedEmail,
} from './index.js';

const appName = 'Nest Vite Starter';

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
    expect(html).toMatch(
      /Didn&#x27;t create a (?:<!-- -->)?Nest Vite Starter(?:<!-- -->)? account\?/,
    );
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
});

/*
 * The document language and the footer are part of the message, not chrome:
 * `<html lang>` decides the voice a screen reader reads the email in, and the
 * footer must be in the same language as the body.
 */
describe('layout language', () => {
  it('the English templates keep lang="en" and the English footer', async () => {
    const html = await renderWelcomeEmail({ appName, loginUrl: 'https://x/auth/login' });
    expect(html).toContain('lang="en"');
    expect(html).toContain('This email was sent by');
  });
});
