import { defineConfig, devices } from '@playwright/test';

/*
 * Env-driven, with the old literal as the default so CI (which sets nothing)
 * is unaffected.
 *
 * Only one checkout can bind :5173, and vite silently auto-increments off a
 * busy port, while the browser happily connects to whatever still owns
 * 5173. A hardcoded host therefore made a second worktree test the FIRST
 * worktree's build and report a green run that proved nothing about its own
 * code: a false pass, which is worse than an error because nothing surfaces
 * it. A parallel checkout now passes the port its vite actually got.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  /*
   * No retries anywhere. With one CI retry a test that failed and then passed
   * counted as green, and the HTML report is uploaded only on failure, so a
   * flaky pass left no artifact and its first failure's trace went nowhere. The
   * failures this suite exists to catch (an infinite-query invalidation miss,
   * agenda paging over a bigger seed) are timing and data-shape bugs, and they
   * first show up as intermittent, so an intermittent failure must stay red.
   *
   * `failOnFlakyTests` does nothing while `retries` is 0, since there is no
   * retry to classify a test as flaky. It stays on in CI as a guard: a
   * `--retries=N` on the command line (or a config edit) can then never turn
   * red into green again. To classify instead of failing fast, switch to
   * `retries: process.env.CI ? 1 : 0` and keep `failOnFlakyTests`; the retry
   * then only labels a failure flaky or broken and cannot hide it.
   */
  retries: 0,
  failOnFlakyTests: !!process.env.CI,
  /*
   * One worker in CI, so the per-IP budgets the whole suite shares through
   * 127.0.0.1 are spent serially. Locally the key is left ABSENT rather than set
   * to undefined, so Playwright applies its own default off the CPU count:
   * `exactOptionalPropertyTypes` rejects an explicit undefined for an optional
   * property, and spelling it that way was this file's live type error until
   * tsconfig.node.json started covering it.
   */
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    // `on-first-retry` never fires with `retries: 0`; keep the trace of a failed attempt.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    /*
     * Signs in as the seeded admin once and saves that browser state, so the
     * specs that only need to BE the admin reuse one session instead of minting
     * four (see e2e/auth.setup.ts for what four cost).
     *
     * `chromium` declares it as a dependency, which is what guarantees the state
     * file exists and is fresh before any spec reads it. No `testIgnore` is
     * needed on `chromium`: the default `testMatch` only picks up *.spec.ts, so
     * *.setup.ts belongs to this project alone.
     */
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  // NOTE: Start dev servers manually before running E2E tests:
  //   1. Start Docker services: docker compose up -d
  //   2. Start dev servers: pnpm dev (or use ./start.sh)
  //   3. Then run: pnpm --filter @repo/web test:e2e
  //
  // If another checkout already owns :5173, vite picks the next free port; pass
  // the one it printed so this run targets your own build:
  //   PLAYWRIGHT_BASE_URL=http://localhost:5174 pnpm --filter @repo/web test:e2e
  //
  // Uncomment below to auto-start (not recommended in this project):
  // webServer: {
  //   command: 'pnpm dev',
  //   url: 'http://localhost:5173',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
});
