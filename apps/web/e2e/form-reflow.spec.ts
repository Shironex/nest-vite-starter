import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE } from './support/auth';

/**
 * Regression pins for the blur-validation reflow across the `mode: 'onBlur'`
 * forms, the audit that followed the same fix on the 2FA challenge form.
 *
 * The mechanism, once, for every test below. `mousedown` on a control moves
 * focus off the field above it, `mode: 'onBlur'` validates, and `FormMessage`
 * renders a message row. `FormMessage` returns null when there is no error, so
 * an appearing message ADDS ~20px of layout rather than filling reserved space:
 * every control below the field shifts down BETWEEN mousedown and mouseup. The
 * mouseup then lands where the control used to be, the browser resolves `click`
 * against the nearest common ancestor of the two targets (the `<form>`), and
 * the control's handler never runs. The press is silently lost, and only the
 * second one works, because by then the message is already on screen.
 *
 * jsdom cannot catch any of this: it has no layout, and `fireEvent.click`
 * dispatches no mousedown at all. Only a real browser reproduces it, which is
 * why these pins live here rather than beside the components.
 *
 * Each pin asserts BOTH halves, because either alone can pass while the bug is
 * back: that the control stays put while a message renders, and that a single
 * real press still reaches its handler.
 *
 * Playwright's `click()` is what makes the outcome half meaningful: it resolves
 * the target point BEFORE pressing, then presses and releases at that same
 * point, so a control that moves in between is missed exactly as a human's
 * cursor would miss it.
 *
 * Prereqs (same as auth-login.spec.ts): docker services + dev servers running,
 * the seeded admin, and the seeded Workspace the DB seed creates for the default
 * organization. The settings group also assumes the admin has 2FA disabled, which is
 * the state the two-factor journeys restore after each of their tests.
 */

/** Frames a settling measurement gives up after, at ~60fps. */
const SETTLE_FRAMES = 120;

/**
 * An element's top edge in DOCUMENT space, once it has stopped moving.
 *
 * Document space, not `boundingBox()`, which is viewport-relative:
 * react-hook-form's `handleSubmit` focuses the first invalid field on a failed
 * submit, and on a long form that scrolls the page, which
 * would move a viewport-relative y for a reason that has nothing to do with
 * this bug. Document space measures the layout itself, the thing under test.
 *
 * Settling, because a dialog opens with a zoom animation: an element is
 * `visible` well before it reaches its final position, and a measurement taken
 * mid-animation reads a fraction of a pixel off. Sampling until two consecutive
 * frames agree keeps that sub-pixel noise out of an assertion whose real
 * subject is a ~20px jump.
 */
async function documentTop(locator: Locator): Promise<number> {
  return locator.evaluate(
    (el, frames) =>
      new Promise<number>((resolve) => {
        let previous = Number.NaN;
        let left = frames;
        const sample = () => {
          const top = el.getBoundingClientRect().top + window.scrollY;
          if (top === previous || left <= 0) {
            resolve(top);
            return;
          }
          previous = top;
          left -= 1;
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    SETTLE_FRAMES,
  );
}

/**
 * Blur `field` so its validation message renders, and assert `control` did not
 * move: the reserved row absorbed the message instead of pushing it down.
 *
 * `blur()` rather than a click elsewhere, so the only layout change in play is
 * the message this one field produces.
 */
async function expectMessageDoesNotMove(
  field: Locator,
  control: Locator,
  message: Locator,
): Promise<void> {
  const before = await documentTop(control);

  await field.focus();
  await field.blur();

  // The message really rendered; without this the position check proves nothing.
  await expect(message).toBeVisible();
  expect(await documentTop(control)).toBe(before);
}

/**
 * One signed-in page for the whole file.
 *
 * Every pin needs the same authenticated admin, and the api throttles globally
 * at 100 requests a minute: a context per test spends a full SPA boot and its
 * own CSRF mint each time, which on its own is enough to trip a limiter and fail
 * the run for a reason that is not the bug. One page shared across tests has to
 * run `serial`, and each test navigates to its own starting screen so the order
 * between them still does not matter.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Blur-validation reflow', () => {
  /*
   * The admin session comes from the setup project, so nothing here logs in.
   * That is not just a saving: this file's `beforeAll` session was the OLDEST of
   * the four admin logins the suite used to make, and `MAX_SESSIONS = 3` evicted
   * exactly it, mid-run, which is what made the last pin below time out on
   * /auth/login. See e2e/auth.setup.ts.
   *
   * `browser.newPage()` below inherits this the same way it already inherits
   * `baseURL`: Playwright fills every context option from `use` that the call
   * does not pass explicitly.
   */
  test.use({ storageState: ADMIN_STORAGE_STATE });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  /** Land on the settings-rail panel that carries the three account-security forms. */
  async function openSecurityTab(): Promise<void> {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Security' }).click();
  }

  test('the change-password submit survives blurring an empty field', async () => {
    await openSecurityTab();

    const submit = page.getByRole('button', { name: 'Change password' });
    await expect(submit).toBeVisible();

    const before = await documentTop(submit);

    // Focus the (empty) current-password field, then press submit: the press
    // that blurs the field is the same press that must reach the button.
    await page.getByLabel('Current password').click();
    await submit.click();

    /*
     * The discriminator. Blurring `currentPassword` produces its own message
     * either way, but the NEW-password message can only come from
     * `handleSubmit`, which only runs if the click actually landed on the
     * button. A swallowed press leaves this one absent.
     */
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
    await expect(page.getByText('Current password is required')).toBeVisible();
    expect(await documentTop(submit)).toBe(before);
  });

  test('the delete-account cancel survives blurring the password field', async () => {
    await openSecurityTab();
    await page.getByRole('button', { name: 'Delete account', exact: true }).click();

    const dialog = page.getByRole('alertdialog');
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeVisible();

    await expectMessageDoesNotMove(
      dialog.getByLabel('Password'),
      cancel,
      dialog.getByText('Password is required'),
    );

    // Reopen for the outcome half: closing resets the form, so the next press
    // is again a first press with no message on screen yet.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Delete account', exact: true }).click();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Password').click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // One press closes it. A swallowed press would leave the dialog up.
    await expect(dialog).toBeHidden();
  });

  test('the enroll wizard Continue button stays put when the password blurs', async () => {
    await openSecurityTab();
    await page.getByRole('button', { name: 'Enable two-factor authentication' }).click();

    const dialog = page.getByRole('dialog');
    const cont = dialog.getByRole('button', { name: 'Continue' });
    await expect(cont).toBeVisible();

    /*
     * Layout half only. The step has no control below the field other than its
     * own submit, and an empty password fails `handleSubmit` too, so a landed
     * press and a swallowed one look identical from the outside. The reserved
     * row is what the fix is, so the reserved row is what is asserted.
     */
    await expectMessageDoesNotMove(
      dialog.getByLabel('Password', { exact: true }),
      cont,
      dialog.getByText('Password is required'),
    );
  });
});
