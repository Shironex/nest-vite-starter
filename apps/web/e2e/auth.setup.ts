import { test as setup } from '@playwright/test';
import { ADMIN_STORAGE_STATE, loginAsAdmin } from './support/auth';

/**
 * Sign in as the seeded admin ONCE per run and hand the resulting browser state
 * to every spec that merely needs to BE that admin.
 *
 * Wired as a `setup` project that `chromium` depends on (playwright.config.ts),
 * so it always runs first and the state file is always minted by the same run
 * that reads it, never left over from a previous one.
 *
 * ## Why
 *
 * Four spec entry points wanted the seeded admin and each logged in for itself:
 * form-reflow's `beforeAll`, the two journeys of a since-removed screen, and the
 * admin-reset test in two-factor. Four concurrent sessions for one user is one too many for
 * `MAX_SESSIONS = 3` (apps/api/.../session.service.ts): `establishSession`
 * evicts that user's OLDEST session right after writing the new one, and the
 * oldest was form-reflow's, the only one of the four still driving a live page
 * minutes later. Its next `page.goto` rendered /auth/login instead of the
 * screen under test, and the pin timed out 120s later with no failing assertion
 * anywhere near the cause.
 *
 * One session shared by all four removes the contention outright instead of
 * ranking the four claims on it. It also drops four logins and four login-page
 * boots from every run, which is headroom against two ceilings the whole suite
 * shares through 127.0.0.1: the per-IP auth envelope (10 logins / 60s,
 * `AUTH_RATE_LIMIT`) and the tighter CSRF-token mint (30 / 60s,
 * apps/api/.../csrf.controller.ts), one of which every SPA boot spends.
 *
 * ## What deliberately keeps a real login
 *
 * Specs whose SUBJECT is signing in: auth-login.spec.ts asserts the login flow
 * end to end, and the two-factor journeys have to watch the password step hand
 * off to the challenge. Reusing state there would delete the coverage.
 *
 * The three 2FA fixture users get no state either, and that is not an
 * oversight: each journey leaves its fixture enrolled on purpose, so a plain
 * password login here would land on /auth/two-factor rather than the dashboard,
 * and the admin reset that makes them signed-in-able is itself the first test of
 * that file. Provisioning them here would move one login per fixture out of the
 * spec and into this file, saving nothing, at the cost of duplicating that
 * reset outside the test that covers it.
 */
setup('sign in as the seeded admin', async ({ page }) => {
  await loginAsAdmin(page);
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
