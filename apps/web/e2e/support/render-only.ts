import { test as base } from '@playwright/test';
import { CSRF_TOKEN_PATH } from '@repo/shared/constants';

/**
 * `test`, for the specs that only assert rendering and client-side navigation
 * and never submit anything. It serves the app's CSRF-token request from the
 * browser instead of the API, so those specs stop spending a budget they do not
 * use.
 *
 * ## Why
 *
 * The app fetches a CSRF token once per SPA boot, eagerly, whether or not the
 * page will mutate anything (apps/web/src/lib/csrf.ts caches the in-flight
 * promise per boot). Every `page.goto` is a fresh boot, so page loads and token
 * requests are one to one.
 *
 * That endpoint carries its own `@Throttle` of 30 requests per 60s per IP,
 * tighter than the global 100/60s because it is unauthenticated
 * (apps/api/src/common/security/csrf.controller.ts). Every Playwright worker
 * drives a browser from the same 127.0.0.1, so the whole suite shares one
 * bucket, and a full run is ~45 page loads.
 *
 * Measured: auth.spec.ts and navigation.spec.ts alone fire 15 of the 30 in
 * 3.3 s. That burst is what pushed the rest of the suite over, and the specs
 * that caused it never used a single one of those tokens; the failures landed
 * instead on the login-bearing specs, as a login that sat on /auth/login with no
 * token to post. Serializing the suite spread the requests out but did not
 * reduce them, so it was not enough on its own.
 *
 * What this deliberately does NOT do is weaken the check anywhere it is under
 * test: auth-login.spec.ts and the journey specs still take a real token from
 * the real endpoint, so the CSRF seam keeps its end-to-end coverage. A spec
 * importing from here is asserting it has no mutation to make; adding one means
 * moving it back to `@playwright/test`.
 */
export const test = base.extend<{ stubCsrfToken: void }>({
  stubCsrfToken: [
    async ({ page }, use) => {
      await page.route(`**${CSRF_TOKEN_PATH}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          // The shape apps/web/src/lib/csrf.ts requires: anything else makes it
          // throw and clear its cache, which would be a behavior change rather
          // than a saved request.
          body: JSON.stringify({ csrfToken: 'e2e-render-only-token' }),
        }),
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
