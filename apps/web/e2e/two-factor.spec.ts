import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { TOTP, Secret } from 'otpauth';
import {
  ADMIN_STORAGE_STATE,
  E2E_FIXTURE_PASSWORD,
  MEMBER_EMAIL,
  SESSION_COOKIE,
  TWO_FACTOR_FIXTURE_EMAILS,
  fillLoginForm,
} from './support/auth';

/**
 * Full 2FA journeys against the real stack. Every journey enrolls ITS OWN
 * seeded fixture user, then exercises one login path: TOTP challenge, backup
 * recovery code, or a trusted browser that skips the challenge.
 *
 * Codes are generated locally with `otpauth`, matching the API TOTP parameters
 * in apps/api/.../auth.constants.ts (SHA1, 6 digits, 30s period). Every TOTP is
 * single-use (the server replay-guards each one), so a journey takes each code
 * from `unusedCodes`, which hands out a different STEP every time instead of
 * waiting for one. Recovery codes are single-use too, so a spent one is never
 * reused.
 *
 * ## One fixture user per journey, and no self-disable
 *
 * These two constraints are the same fix, and together they are what makes a
 * whole-file run repeatable:
 *
 * 1. `TWO_FACTOR_MANAGE_RATE_LIMIT` is 5 per 300 s PER USER, armed on the first
 *    hit and never slid. Enrolling costs two (beginEnrollment + activate), so a
 *    single shared account puts ~8 manage operations inside overlapping windows
 *    and the limiter rejects the tail of the run, surfacing as a stuck wizard
 *    with no visible error, because the toast auto-dismisses long before
 *    Playwright snapshots it. A user per journey keeps TWO back-to-back
 *    whole-file runs at 4 of the 5.
 * 2. Nothing here calls `twoFactor.disable`. It would be a third manage
 *    operation per journey (6 across two runs, one over the limit), and as
 *    inline cleanup it is skipped by exactly the failures that most need it,
 *    which is what strands SecondFactor rows until someone clears them by hand.
 *    The first test in the group resets every fixture instead, so the file
 *    self-heals on the way IN rather than on the way out and a killed run costs
 *    nothing. The disable dialog keeps its own coverage in DisableDialog.test.tsx
 *    and the api service specs.
 *
 * The group is `serial` for a reason unrelated to the accounts: login is rate
 * limited per IP (10 per 60 s) and every worker shares 127.0.0.1, so the
 * journeys must not fire their logins concurrently.
 *
 * Prereqs (same as auth-login.spec.ts): docker services + dev servers running,
 * and a seeded database (ADMIN_EMAIL / ADMIN_PASSWORD plus the e2e fixtures).
 */

const TOTP_PERIOD_MS = 30_000;

function makeTotp(secretBase32: string): TOTP {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

/**
 * Codes for one user, none of which the server has seen.
 *
 * The api validates with window 1 and then claims the ACCEPTED counter for 90s
 * (TotpService.verify), so the previous, current and next step are three
 * distinct single-use codes, not one code three times. Generating for a
 * neighboring step is therefore an unused code on demand, where this used to
 * sleep up to a full 30s window per verification.
 *
 * Preference order is next, current, previous. The next step is the safe side
 * of a window boundary: if the clock rolls over between generating and
 * verifying, a next-step code becomes the current one and still validates,
 * while a previous-step code would fall two steps behind and be rejected.
 * Spent steps are remembered, so two verifications inside one window never
 * collide; running out throws instead of quietly replaying.
 */
function unusedCodes(totp: TOTP): () => string {
  const spent = new Set<number>();

  return () => {
    const current = Math.floor(Date.now() / TOTP_PERIOD_MS);

    for (const step of [current + 1, current, current - 1]) {
      if (spent.has(step)) {
        continue;
      }
      spent.add(step);
      return totp.generate({ timestamp: step * TOTP_PERIOD_MS });
    }

    throw new Error(
      'All three codes the api would accept are spent inside one 30s window. ' +
        'This journey needs a fourth verification, which has to wait for a real window.',
    );
  };
}

/** HTTP status the api answers a spent rate-limit window with (`RateLimitError`). */
const TOO_MANY_REQUESTS = 429;

/**
 * How long a login may keep drawing 429 before the journey gives up: one whole
 * `AUTH_RATE_WINDOW_SECONDS` (60 s in apps/api auth-shared.service.ts), with
 * room for the retry that lands just after it rolls over.
 */
const LOGIN_WINDOW_BUDGET_MS = 80_000;

/** Resubmit this often while the window is spent; each refusal costs nothing. */
const LOGIN_RETRY_INTERVAL_MS = 10_000;

/**
 * Submit the login form and stop wherever it lands.
 *
 * Unlike `login` in ./support/auth, this deliberately asserts nothing about the
 * destination: these tests use it precisely to observe whether the password
 * step hands off to the 2FA challenge or straight to the dashboard.
 *
 * It does ride out ONE spent login window. The whole suite signs in 11 times
 * from 127.0.0.1 against a fixed window of 10 per 60 s, and these journeys own
 * 7 of them, so whether they fit depends on which spec files the scheduler
 * happens to run beside them. A longer file list spreads them over two windows
 * by luck; a shorter one packs them into one, and the last journey reliably
 * drew "Too many attempts". `describe.serial` cannot
 * help, since the other files' logins are in the same window. Only a 429 is
 * retried, and only for about one window, so a limiter that refuses everything
 * still fails here, and any other answer is left for the test to assert on.
 */
async function loginUnasserted(page: Page, email: string): Promise<void> {
  await expect(async () => {
    await fillLoginForm(page, email, E2E_FIXTURE_PASSWORD);
    const answered = page.waitForResponse((response) => response.url().includes('auth.login'));
    await page.getByRole('button', { name: 'Sign in' }).click();
    expect((await answered).status()).not.toBe(TOO_MANY_REQUESTS);
  }).toPass({ intervals: [LOGIN_RETRY_INTERVAL_MS], timeout: LOGIN_WINDOW_BUDGET_MS });
}

/**
 * Enroll the (already-signed-in) fixture user in TOTP from the settings
 * security panel and return the shared `TOTP` plus the one-time recovery codes
 * shown at the end of the wizard.
 */
async function enroll(page: Page): Promise<{ nextCode: () => string; recoveryCodes: string[] }> {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Security' }).click();
  await page.getByRole('button', { name: /enable two-factor authentication/i }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Password', { exact: true }).fill(E2E_FIXTURE_PASSWORD);
  await dialog.getByRole('button', { name: 'Continue' }).click();

  // Read the manual-entry secret and confirm with a fresh code.
  const secret =
    (await page.locator('[data-slot="two-factor-enroll-wizard"] code').textContent())?.trim() ?? '';
  expect(secret.length).toBeGreaterThan(0);
  const nextCode = unusedCodes(makeTotp(secret));

  await dialog.getByLabel('Verification code').fill(nextCode());
  await dialog.getByRole('button', { name: /verify and enable/i }).click();

  // Recovery codes are shown exactly once; capture them before acknowledging.
  await expect(dialog.getByText(/save your recovery codes/i)).toBeVisible();
  const recoveryCodes = (
    await page.locator('[data-slot="recovery-codes-panel"] li').allTextContents()
  ).map((code) => code.trim());
  await dialog.getByRole('button', { name: 'Done' }).click();

  return { nextCode, recoveryCodes };
}

/**
 * Reset one member's 2FA from the (already-signed-in) admin's members tab.
 *
 * Asserting the post-state rather than the transition is what makes this
 * re-runnable: `resetUserTwoFactor` wipes factors unconditionally, so a
 * member who is already 2FA-free ends up exactly where an enrolled one does.
 *
 * Split in two so a caller can assert something between the confirm click and
 * the settled post-state (the success toast, which auto-dismisses).
 */
interface IPendingReset {
  dialog: Locator;
  memberRow: Locator;
}

async function confirmMemberTwoFactorReset(page: Page, email: string): Promise<IPendingReset> {
  const memberRow = page.getByRole('row').filter({ hasText: email });
  await expect(memberRow).toBeVisible();
  await memberRow.getByRole('button', { name: `Actions for ${email}` }).click();
  await page.getByRole('menuitem', { name: 'Reset two-factor' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/reset two-factor for this member/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Reset two-factor' }).click();
  return { dialog, memberRow };
}

async function expectMemberTwoFactorResetSettled({
  dialog,
  memberRow,
}: IPendingReset): Promise<void> {
  // Waiting for the dialog to go means the next row's button cannot be clicked
  // through a still-open overlay. The badge is the durable post-state: it only
  // flips once the mutation landed AND the members list refetched.
  await expect(dialog).toBeHidden();
  await expect(memberRow.getByText('Disabled')).toBeVisible();
}

async function resetUserTwoFactor(page: Page, email: string): Promise<void> {
  await expectMemberTwoFactorResetSettled(await confirmMemberTwoFactorReset(page, email));
}

/**
 * Regression pins for the challenge form's blur-validation reflow. Unlike the
 * journeys below these need no API, DB, or enrolled account: the challenge
 * route renders standalone, and the bug was purely client-side layout.
 *
 * Pressing any control below the code field moved focus off that (autofocused,
 * empty) input. `mode: 'onBlur'` then rendered "Code is required" between the
 * input and the control, pushing the control ~14px down BETWEEN mousedown and
 * mouseup. The browser resolves `click` against the nearest common ancestor of
 * the two, so the press landed on the form and the control never fired: the
 * backup-code toggle never flipped and the trust checkbox never checked. Both
 * only worked on a second press, once the message was already rendered.
 *
 * jsdom cannot catch this (no layout, and `fireEvent.click` dispatches no
 * mousedown), so the pins have to be real-browser clicks.
 */
test.describe('Two-factor challenge form (no backend required)', () => {
  test('the backup-code toggle survives the blur-validation reflow', async ({ page }) => {
    await page.goto('/auth/two-factor');

    const toggle = page.getByRole('button', { name: 'Use a recovery code' });
    await expect(toggle).toBeVisible();
    const before = await toggle.boundingBox();

    // A real click: mousedown focuses, mouseup must still land on the button.
    await toggle.click();

    await expect(page.getByLabel('Recovery code')).toBeVisible();
    // The mechanism, not just the outcome: pressing the toggle must not move it.
    const after = await page
      .getByRole('button', { name: 'Enter the code from the app' })
      .boundingBox();
    expect(after?.y).toBe(before?.y);

    // Switching modes drops the stale required-message from the TOTP field.
    await expect(page.getByText('Code is required')).toBeHidden();
  });

  test('the trust checkbox checks on the first press', async ({ page }) => {
    await page.goto('/auth/two-factor');

    const trust = page.getByLabel('Remember this browser for 30 days');
    await expect(trust).toBeVisible();
    const before = await trust.boundingBox();

    await trust.click();

    // `check()` would retry a swallowed press; a single click must be enough.
    await expect(trust).toBeChecked();
    expect((await trust.boundingBox())?.y).toBe(before?.y);
  });
});

test.describe.serial('Two-factor authentication (real enroll + challenge)', () => {
  // Each test aligns to fresh TOTP windows up to twice (<=30s each).
  test.setTimeout(180_000);

  /*
   * Declared FIRST on purpose: `describe.serial` runs its whole group (nested
   * describes included) in declaration order, so this both covers the admin
   * reset and hands the journeys below a 2FA-free fixture, whatever the previous
   * run left behind.
   *
   * The journeys deliberately do not disable themselves afterwards (see the
   * file header), so on a clean re-run every fixture arrives here still
   * enrolled from last time. Resetting on the way IN rather than on the way out
   * is what survives a run killed mid-journey, the case that used to leave
   * orphaned SecondFactor rows behind.
   *
   * Nested solely to scope `test.use`. This is the one test in the file that
   * acts as the admin, and it takes that session from the setup project rather
   * than logging in: four separate admin logins exceeded `MAX_SESSIONS = 3` and
   * evicted a session another spec was still driving (see e2e/auth.setup.ts).
   * The journeys below must keep starting signed OUT, since the login itself is
   * what they are watching, so the option cannot go on the whole group.
   */
  test.describe('as the seeded admin', () => {
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test("an admin resets a member's two-factor from the members tab", async ({ page }) => {
      // The Members rail row is admin-only; the seeded member starts with
      // 2FA enabled.
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Members' }).click();

      // Success surfaces as a toast; the row's 2FA badge flips to Disabled once
      // the members list refetches.
      // The toast is checked before the settle waits, and only for this first
      // reset: it auto-dismisses, so asserting it after the badge has settled
      // races its timeout, and four in a row would stack into an ambiguous
      // locator.
      const pending = await confirmMemberTwoFactorReset(page, MEMBER_EMAIL);
      await expect(page.getByText('Two-factor reset for this member')).toBeVisible();
      await expectMemberTwoFactorResetSettled(pending);

      // Same procedure, now as fixture hygiene for the journeys below.
      for (const email of Object.values(TWO_FACTOR_FIXTURE_EMAILS)) {
        await resetUserTwoFactor(page, email);
      }
    });
  });

  test('enrolls, then gates the next login behind a TOTP challenge', async ({ page }) => {
    const email = TWO_FACTOR_FIXTURE_EMAILS.totp;
    await loginUnasserted(page, email);
    await expect(page).toHaveURL(/\/dashboard/);

    const { nextCode } = await enroll(page);

    // Simulate a logout by dropping every cookie, then log in again.
    await page.context().clearCookies();
    await loginUnasserted(page, email);

    // The password login now routes to the challenge instead of the dashboard.
    await expect(page).toHaveURL(/\/auth\/two-factor/);
    await page.getByLabel('Code from the app').fill(nextCode());
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('logs in with a backup recovery code when the authenticator is unavailable', async ({
    page,
  }) => {
    const email = TWO_FACTOR_FIXTURE_EMAILS.recovery;
    await loginUnasserted(page, email);
    await expect(page).toHaveURL(/\/dashboard/);

    const { recoveryCodes } = await enroll(page);
    const backupCode = recoveryCodes[0] ?? '';
    expect(backupCode).not.toBe('');

    await page.context().clearCookies();
    await loginUnasserted(page, email);
    await expect(page).toHaveURL(/\/auth\/two-factor/);

    // Switch to backup-code mode and redeem a single-use recovery code (no time
    // window to wait for; recovery codes are not TOTP).
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await page.getByLabel('Recovery code').fill(backupCode);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('trusting the browser skips the challenge on the next login', async ({ page }) => {
    const email = TWO_FACTOR_FIXTURE_EMAILS.trust;
    await loginUnasserted(page, email);
    await expect(page).toHaveURL(/\/dashboard/);

    const { nextCode } = await enroll(page);

    // First post-enroll login: pass the challenge AND trust this browser, which
    // sets the long-lived `2fa-trust` cookie.
    await page.context().clearCookies();
    await loginUnasserted(page, email);
    await expect(page).toHaveURL(/\/auth\/two-factor/);
    await page.getByLabel('Remember this browser for 30 days').check();
    await page.getByLabel('Code from the app').fill(nextCode());
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Log out but KEEP the trust cookie (drop only the session cookie): the next
    // login must land straight on the dashboard with no challenge.
    await page.context().clearCookies({ name: SESSION_COOKIE });
    await loginUnasserted(page, email);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page).not.toHaveURL(/\/auth\/two-factor/);
  });
});
