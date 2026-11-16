import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_STORAGE_STATE,
  ADMIN_TARGET_FIXTURE_EMAIL,
  E2E_FIXTURE_PASSWORD,
  login,
} from './support/auth';

/**
 * The admin page against the real stack: the users table and the audit list.
 *
 * Every journey acts on ONE dedicated fixture (`ADMIN_TARGET_FIXTURE_EMAIL`),
 * so no other spec file contends for its role, status or sessions. The group
 * is serial because the journeys share that account.
 *
 * Re-runnable: each journey hands the fixture back as it found it (a plain,
 * active USER), and the role-change journey first normalizes a fixture a
 * killed run left as an ADMIN. A re-seed resets it as well.
 *
 * Prereqs (same as two-factor.spec.ts): docker services + dev servers running,
 * and a seeded database (ADMIN_EMAIL / ADMIN_PASSWORD plus the e2e fixtures).
 */

/**
 * The user's row in the USERS table. Scoped to that section because the audit
 * list below also has rows naming the same address (as actor or target).
 */
function rowFor(page: Page, email: string): Locator {
  return page
    .locator('[data-slot="admin-users-section"]')
    .getByRole('row')
    .filter({ hasText: email });
}

async function openRowAction(page: Page, email: string, action: string): Promise<Locator> {
  const row = rowFor(page, email);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Actions for ${email}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
  return page.getByRole('dialog');
}

async function changeRole(page: Page, email: string, to: 'Administrator' | 'User') {
  const dialog = await openRowAction(page, email, 'Change role');
  await expect(dialog.getByText(new RegExp(`to "${to}"`))).toBeVisible();
  await dialog.getByRole('button', { name: 'Change role' }).click();
  await expect(dialog).toBeHidden();
  await expect(rowFor(page, email).getByRole('cell', { name: to, exact: true })).toBeVisible();
}

test.describe.serial('Admin page', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("the admin's own row offers nothing the self guards refuse", async ({ page }) => {
    await page.goto('/admin');

    const row = rowFor(page, ADMIN_EMAIL);
    await expect(row.getByText('You', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: `Actions for ${ADMIN_EMAIL}` }).click();

    await expect(page.getByRole('menuitem', { name: 'Change role' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Sign out everywhere' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Disable account' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Delete account' })).toHaveCount(0);
  });

  test('a role change applies, signs the user out, and lands in the audit list', async ({
    page,
    browser,
  }) => {
    await page.goto('/admin');
    const row = rowFor(page, ADMIN_TARGET_FIXTURE_EMAIL);
    await expect(row).toBeVisible();

    // A killed run can leave the fixture promoted; put it back first.
    if (await row.getByRole('cell', { name: 'Administrator', exact: true }).isVisible()) {
      await changeRole(page, ADMIN_TARGET_FIXTURE_EMAIL, 'User');
    }

    // The target signs in elsewhere, so the revocation has a session to end.
    // A context made here inherits the project options, the admin's storage
    // state included, so drop those cookies before signing in as the target.
    const targetContext = await browser.newContext();
    await targetContext.clearCookies();
    const targetPage = await targetContext.newPage();
    try {
      await login(targetPage, ADMIN_TARGET_FIXTURE_EMAIL, E2E_FIXTURE_PASSWORD);

      await changeRole(page, ADMIN_TARGET_FIXTURE_EMAIL, 'Administrator');

      // The role is snapshotted into the session, so the change must end it:
      // the target's next authenticated page load bounces to sign-in.
      await targetPage.goto('/dashboard');
      await expect(targetPage).toHaveURL(/\/auth\/login/);
    } finally {
      await targetContext.close();
    }

    // Demote again, which leaves the fixture as it was.
    await changeRole(page, ADMIN_TARGET_FIXTURE_EMAIL, 'User');

    const audit = page.locator('[data-slot="admin-audit-section"]');
    await expect(audit.getByText('Role changed').first()).toBeVisible();
  });

  test('an admin disables an account and enables it again', async ({ page }) => {
    await page.goto('/admin');
    const row = rowFor(page, ADMIN_TARGET_FIXTURE_EMAIL);

    let dialog = await openRowAction(page, ADMIN_TARGET_FIXTURE_EMAIL, 'Disable account');
    await dialog.getByRole('button', { name: 'Disable account' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText('Account disabled', { exact: true })).toBeVisible();

    dialog = await openRowAction(page, ADMIN_TARGET_FIXTURE_EMAIL, 'Enable account');
    await dialog.getByRole('button', { name: 'Enable account' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
  });

  test('an admin signs a user out everywhere', async ({ page }) => {
    await page.goto('/admin');

    const dialog = await openRowAction(page, ADMIN_TARGET_FIXTURE_EMAIL, 'Sign out everywhere');
    await dialog.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(dialog).toBeHidden();

    const audit = page.locator('[data-slot="admin-audit-section"]');
    await expect(
      audit.getByText('Signed out of every session by an administrator').first(),
    ).toBeVisible();
  });
});
