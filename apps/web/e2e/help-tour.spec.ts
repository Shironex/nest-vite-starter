import { test, expect } from '@playwright/test';
import { login, E2E_FIXTURE_PASSWORD, TOUR_FIXTURE_EMAIL } from './support/auth';

/**
 * A guided tour still starts on its own for somebody who has never answered.
 *
 * ## Why this spec exists at all
 *
 * The rest of the suite is deterministic because the seed writes an answered
 * `TourProgress` row for every fixture account (E2E_ANSWERED_TOURS in
 * packages/database/prisma/seed.ts). Without that, a tour auto-starts on a
 * fresh CI database, driver.js masks everything outside its spotlight, and the
 * next spec's click retries against the mask until it times out, which is
 * exactly how two journeys went red on CI while passing locally.
 *
 * Seeding an answer is the honest fix precisely because it changes no product
 * code, but it has an obvious failure mode: if the launcher stopped starting
 * tours tomorrow, every spec would still be green and nobody would find out
 * from this suite. So one fixture account is held back with no progress at all,
 * and this is the spec that signs in as it.
 *
 * ## Why it resets before it asserts
 *
 * A run that ends with the tour on screen writes nothing, but a run killed
 * halfway might, and the account would then be answered for every later run.
 * Resetting first makes the spec re-runnable against the same database, and
 * "reset" is not a weaker starting point than "never seen": `resetForUser`
 * stores an empty map and `getForUser` returns an empty map for a user with no
 * row at all, so the launcher cannot tell the two apart. It also puts the
 * replay control itself under test, which nothing else covers end to end.
 *
 * Prereqs: docker services + dev servers running, and a seeded database.
 */
test.describe('Guided tours', () => {
  test('auto-start for a user who has answered none of them', async ({ page }) => {
    await login(page, TOUR_FIXTURE_EMAIL, E2E_FIXTURE_PASSWORD);

    // A full load rather than a click-through: it lands on a screen with no
    // tour registered, so nothing can be covering the controls below, whatever
    // state a previous run left this account in.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('button', { name: 'Show them all again' }).click();

    // The stored state, not the toast: this is the precondition the assertion
    // below depends on, so it is asserted on the durable half.
    const statuses = page.locator('[data-slot="help-tour-row"] td:nth-child(3)');
    await expect(statuses.first()).toHaveText('Not seen yet');
    const count = await statuses.count();
    for (let index = 0; index < count; index += 1) {
      await expect(statuses.nth(index)).toHaveText('Not seen yet');
    }

    // Arrive on the dashboard the way that user would, with nothing asking for
    // a tour: a fresh document, so the launcher's per-session "already started"
    // memory is empty too.
    await page.goto('/dashboard');

    const popover = page.locator('.driver-popover.starter-tour');
    await expect(popover).toBeVisible();
    // The first step of the dashboard tour (tours.dashboard.app-sidebar.title),
    // so a popover that appeared for some other reason would not satisfy this.
    await expect(popover).toContainText('App menu');
  });
});
