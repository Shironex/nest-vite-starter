import { test, expect } from './support/render-only';
import { ADMIN_STORAGE_STATE } from './support/auth';

/**
 * Every authenticated route has exactly one `<h1>`, and it is the shell
 * topbar's page title (issue D09).
 *
 * ## Why this is an e2e spec and not a unit test
 *
 * The invariant is a property of the COMPOSED document: the topbar draws the
 * `<h1>` in `_authenticated`, each page draws its own subtree, and only the
 * router puts the two together. A vitest test would have to hand-assemble
 * `AppTopbar` next to a page component, which asserts a composition the app
 * never actually performs: it would stay green while a real route grew a
 * second `<h1>`, which is the exact regression this exists to catch. The unit
 * suite covers the half it can see honestly (`AppTopbar.test.tsx` pins that the
 * topbar renders one, and one only); this covers the other half.
 *
 * Matched by tag rather than by `heading, level: 1`: a route that opens a modal
 * (a confirm dialog on `/settings`, say) gets `aria-hidden` on everything behind the overlay, which
 * takes the topbar out of the accessibility tree and would make a role-based
 * count read zero. The acceptance criterion is about the markup, so the
 * assertion is too.
 *
 * Prereqs: docker services + dev servers running, and the seeded ADMIN.
 */

/** Route to the `pageTitle.*` string `Layout.nav.ts` resolves for it. */
const ROUTE_TITLES: ReadonlyArray<readonly [string, string]> = [
  ['/dashboard', 'Dashboard'],
  ['/admin', 'Admin'],
  ['/settings', 'Settings'],
];

test.describe('App shell headings', () => {
  /*
   * The seeded admin from the setup project, not a login of its own: this spec
   * only needs to BE an admin, and some of the routes above are ADMIN-gated. See
   * e2e/auth.setup.ts for what a fifth concurrent admin session would cost.
   */
  test.use({ storageState: ADMIN_STORAGE_STATE });

  for (const [path, title] of ROUTE_TITLES) {
    test(`${path} has exactly one h1, carrying the page title`, async ({ page }) => {
      await page.goto(path);

      const h1 = page.locator('h1');
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(title);
    });
  }
});
