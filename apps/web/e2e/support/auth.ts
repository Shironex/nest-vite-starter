import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Shared login plumbing for the specs that need a real authenticated session.
 *
 * The seeded admin comes from the DB seed (packages/database/prisma/seed.ts),
 * which upserts ADMIN_EMAIL / ADMIN_PASSWORD. Reading the same env vars here,
 * with the .env.example defaults as the fallback, keeps every spec in step with
 * whatever the CI seed step provisions rather than hardcoding credentials in
 * three places.
 */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'P@ssw0rd!Change.Me';

/** Seeded dev/e2e fixture member in the admin's tenant, seeded with 2FA on. */
export const MEMBER_EMAIL = process.env.MEMBER_EMAIL ?? 'member@example.com';

/**
 * Dedicated fixture accounts, one per spec family, so no two spec FILES contend
 * for the same user's state.
 *
 * Playwright runs spec files concurrently at default local parallelism and
 * `test.describe.serial` only serializes within a file, so anything a spec
 * holds exclusively (an enrolled 2FA factor, a failed-attempt counter) has
 * to live on an account no other file touches.
 *
 * Literals, not env vars, and MUST match E2E_FIXTURE_USERS /
 * E2E_FIXTURE_PASSWORD in packages/database/prisma/seed.ts. The seed only
 * provisions them under NODE_ENV !== 'production', so they are never a
 * deployment credential the way ADMIN_* is; a drift between the two lists fails
 * loudly on the very first login rather than silently.
 */
export const E2E_FIXTURE_PASSWORD = 'P@ssw0rd!Change.Me';

/** auth-login.spec.ts. Owns the deliberate wrong-password submit. */
export const LOGIN_FIXTURE_EMAIL = 'e2e-login@example.com';

/**
 * two-factor.spec.ts, one per journey in its serial group.
 *
 * Per JOURNEY, not per file, because `TWO_FACTOR_MANAGE_RATE_LIMIT` is 5 per
 * 300 s PER USER (apps/api/.../auth.constants.ts) and each journey spends two
 * of them enrolling. A single account for the whole file would put roughly eight
 * manage operations inside overlapping windows, and the limiter rejects the tail
 * of any run that does.
 */
export const TWO_FACTOR_FIXTURE_EMAILS = {
  totp: 'e2e-2fa-totp@example.com',
  recovery: 'e2e-2fa-recovery@example.com',
  trust: 'e2e-2fa-trust@example.com',
} as const;

/**
 * help-tour.spec.ts. The one fixture the seed leaves with NO tour progress.
 *
 * Every other account in this file is seeded as having answered every guided
 * tour, so no tour can auto-start over a spec's click (see E2E_ANSWERED_TOURS
 * in packages/database/prisma/seed.ts). That determinism is worth exactly
 * nothing if it also means a broken tour would never be noticed, so this
 * account is held back and one spec signs in as it.
 *
 * MUST match E2E_TOUR_FIXTURE_EMAIL in packages/database/prisma/seed.ts.
 */
export const TOUR_FIXTURE_EMAIL = 'e2e-tour@example.com';

/**
 * The session cookie, matched by both spellings the API can issue.
 *
 * `getSessionCookieName(isProduction)` prefixes the name with `__Host-` only
 * under NODE_ENV=production, because the prefix requires Secure and local http
 * cannot satisfy it (apps/api/.../auth.constants.ts). A spec that hardcodes
 * either spelling is therefore wrong against one of the two stacks it has to
 * run on: CI boots the API in production mode, a local `pnpm dev` does not.
 *
 * Deliberately NOT derived from `process.env.NODE_ENV`: this process is
 * Playwright, not the API, and the two do not share an environment. CI sets
 * NODE_ENV=production on the "Start API" step alone, so the test runner reads it
 * as undefined while the API is issuing `__Host-session_id`; an env-derived
 * name is wrong in exactly the environment a hardcoded production name gets
 * right. A pattern covering both is correct against either stack, and the prefix
 * is not what any assertion here is about: they are about a real httpOnly
 * session existing, and about dropping it while keeping the trust cookie.
 */
export const SESSION_COOKIE = /^(__Host-)?session_id$/;

/** The session cookie from a `context.cookies()` result, if one was issued. */
export function findSessionCookie<T extends { name: string }>(cookies: T[]): T | undefined {
  return cookies.find((cookie) => SESSION_COOKIE.test(cookie.name));
}

/**
 * Open /auth/login, fill the credentials, and wait for the Turnstile token.
 *
 * The login form gates submission on a Turnstile token (loginSchema requires
 * turnstileToken via react-hook-form). The page renders Cloudflare's always-pass
 * test widget, which writes the token into a hidden input asynchronously.
 * Clicking "Sign in" before that input has a value means client validation
 * silently blocks the submit and the browser never leaves /auth/login.
 *
 * Stops short of clicking on purpose: callers branch afterwards; one asserts a
 * rejected password, one expects a 2FA challenge, one expects the dashboard.
 */
export async function fillLoginForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/);
}

/**
 * Sign in and land on the authenticated dashboard.
 *
 * Asserting the URL before returning means a caller's first real assertion
 * fails on its own subject rather than on a login that quietly did not happen.
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await fillLoginForm(page, email, password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Sign in as the seeded admin and land on the authenticated dashboard.
 *
 * One caller only, and deliberately: e2e/auth.setup.ts runs this ONCE per run
 * and every admin-facing spec reuses the resulting `ADMIN_STORAGE_STATE`
 * instead of signing in for itself. See that file for why four independent
 * admin logins broke the suite.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Where the setup project parks the signed-in admin's browser state, for the
 * specs that reuse it through `test.use({ storageState })`.
 *
 * Absolute, derived from this module's own URL, because writer and readers do
 * not share a working directory: Playwright resolves a relative `storageState`
 * against the config directory but `storageState({ path })` against the
 * runner's cwd, so one relative literal cannot be right for both.
 *
 * Never committed: the file holds a live session cookie (see .gitignore).
 */
export const ADMIN_STORAGE_STATE = fileURLToPath(new URL('../.auth/admin.json', import.meta.url));
