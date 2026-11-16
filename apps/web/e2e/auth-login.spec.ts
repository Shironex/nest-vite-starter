import { test, expect } from '@playwright/test';
import {
  E2E_FIXTURE_PASSWORD,
  LOGIN_FIXTURE_EMAIL,
  fillLoginForm,
  findSessionCookie,
} from './support/auth';

/**
 * Real end-to-end login. Unlike auth.spec.ts (which only asserts pages render),
 * this proves the full auth/session seam works: submit real credentials, reach
 * the authenticated area, and confirm the gated user.me data renders behind a
 * real httpOnly session cookie.
 *
 * Cookie name: CI boots the API with NODE_ENV=production, so the session cookie
 * carries the __Host- prefix, while a local dev API issues the bare name (see
 * apps/api .../auth.constants.ts). `findSessionCookie` matches either, so this
 * spec is green on both stacks rather than only in CI. Chromium treats
 * http://localhost as a trustworthy origin, so the Secure + __Host- cookie is
 * accepted in this http-only e2e environment.
 *
 * Account: a dedicated seeded fixture, not the shared admin. The
 * second test below deliberately submits a wrong password against
 * MAX_FAILED_ATTEMPTS = 5, so the failed-attempt counter it drives has to sit
 * on an account no other spec file depends on being able to log into. The
 * counter cannot creep across runs either: the successful login above it in the
 * same file resets it.
 */

test.describe('Authentication (real login)', () => {
  test('logs in with a seeded user and reaches the authenticated dashboard', async ({ page }) => {
    await fillLoginForm(page, LOGIN_FIXTURE_EMAIL, E2E_FIXTURE_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Lands on the gated dashboard rather than bouncing back to login.
    await expect(page).toHaveURL(/\/dashboard/);

    // The dashboard greeting names the logged-in account, which can only come
    // from the gated user.me query (AuthMiddleware). Proving it is visible
    // proves the session authorizes a gated request end to end.
    //
    // Matched by slot rather than by heading role: the re-skin dropped
    // the page-level <h1> so it stops competing with the topbar title.
    //
    // An account with no display name is greeted by its email's LOCAL PART
    // rather than the whole address, so that is what is asserted. It is still
    // the fixture's own identity and still can only have come off the gated
    // read: no other account on the seed answers to it.
    const [localPart] = LOGIN_FIXTURE_EMAIL.split('@');
    await expect(page.locator('[data-slot="dashboard-greeting"]')).toContainText(
      new RegExp(`Good day, ${localPart}`),
    );

    // The session cookie must be a real httpOnly session_id. No URL arg so we
    // get cookies regardless of which origin/port they landed on.
    const cookies = await page.context().cookies();
    const session = findSessionCookie(cookies);
    expect(session, 'session cookie should be set after login').toBeTruthy();
    expect(session?.value, 'session cookie should have a value').toBeTruthy();
    expect(session?.httpOnly, 'session cookie should be httpOnly').toBe(true);
  });

  test('rejects a wrong password and stays on the login page with an error', async ({ page }) => {
    await fillLoginForm(page, LOGIN_FIXTURE_EMAIL, 'definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Stays on /auth/login (no redirect to the authenticated area).
    await expect(page).toHaveURL(/\/auth\/login/);
    /*
     * The banner says the credentials were wrong, in the AppErrorCode strings table's
     * words rather than the server's own sentence (`translateAppError` used to
     * fall through to it). Asserting the message rather than a data attribute is
     * deliberate: the copy IS the behavior here, and the previous wording (the
     * generic UNAUTHORIZED sentence, "Sign in to perform this operation.") told
     * a person on the sign-in page to sign in.
     */
    await expect(page.locator('form')).toContainText('Incorrect email or password.');

    // No session cookie was issued for the failed attempt.
    const cookies = await page.context().cookies();
    expect(findSessionCookie(cookies)?.value ?? '').toBe('');
  });
});
