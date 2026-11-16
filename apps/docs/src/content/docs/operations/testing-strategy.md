---
title: Testing Strategy
description: Test inventory across api, web, e2e, and the tenant isolation lane, plus what each CI job actually runs.
sidebar:
  order: 4
---

:::note
This page is the per-suite detail. For the tooling that runs them - `pnpm verify`
and its profiles, the per-worktree sandbox, the e2e lane, the security spec and the
isolation canary - see [Verification Harness](/operations/verification-harness/).
:::

## Inventory at a glance

These counts are not typed by hand any more. They come from
`tools/verify/inventories/`, the committed baselines that `pnpm verify:inventory`
compares every run against, so the table below is wrong only if someone changed a
suite without accepting the baseline, which the gate refuses.

| Suite                     | Runner     | Location                              | Files | Cases    | Live services                      |
| ------------------------- | ---------- | ------------------------------------- | ----- | -------- | ---------------------------------- |
| API fast lane             | Jest       | `apps/api/src/**/*.spec.ts`           | 206   | 3642     | No, Prisma and Redis are mocked    |
| API tenant-isolation lane | Jest       | `apps/api/src/**/*.isolation.spec.ts` | 12    | 156      | Yes, live Postgres                 |
| Web unit and component    | Vitest     | `apps/web/src/**/*.test.ts(x)`        | 287   | 2272     | No                                 |
| Web e2e                   | Playwright | `apps/web/e2e/*.spec.ts`              | 15    | 46       | Yes, built API plus `vite preview` |
| Internal ESLint plugin    | Vitest     | `packages/eslint-plugin-repo`         | 24    | 497      | No                                 |
| Shared                    | Vitest     | `packages/shared`                     | 14    | 295      | No                                 |
| UI                        | Vitest     | `packages/ui`                         | 15    | 141      | No                                 |
| ESLint config wiring      | Vitest     | `packages/eslint-config`              | 7     | 65       | No                                 |
| Email templates           | Vitest     | `packages/email`                      | 1     | 29       | No                                 |
| **Total**                 |            |                                       |       | **7143** |                                    |

Two suites are deliberately outside the inventory. `apps/api/security-spec` is
reconciled case by case against `findings.json` by `pnpm check:security`, which is a
stricter version of the same idea, and `tools/` runs under `pnpm test:lint-meta`.

Refresh this table with `pnpm verify:inventory --accept` and then re-read the baselines;
do not edit the numbers by hand.

## API tests (`apps/api`)

Config: `apps/api/jest.config.js`. Key properties:

- `rootDir: 'src'`, `testRegex: '.*\\.spec\\.ts$'`, but `testPathIgnorePatterns: ['\\.isolation\\.spec\\.ts$']`: the fast lane explicitly excludes isolation specs.
- `setupFiles: ['<rootDir>/../test/setup-env.ts']` seeds required env vars (e.g. the Joi-required `ENCRYPTION_KEY`) before any spec runs, so a boot-style spec can't fail the whole suite at config validation.
- Transform via `@swc/jest` (fast, no ts-jest compile step).
- Coverage collected from all `.ts` under `src` except `*.spec.ts`, `*.module.ts`, `main.ts`, `@generated/**`, and a short explicit-exclusion list: `common/websocket/redis-io.adapter.ts`, `common/database/prisma.service.ts` (both need an e2e harness or framework passthroughs the fast suite can't provide), `common/database/tenant-scope.extension.ts` (covered by the isolation lane instead, since the fast suite mocks `PrismaService`), `common/decorators/public.decorator.ts`, `config/configuration.config.ts`.
- Coverage reporters: `text`, `lcov`, `json-summary`: the `json-summary` reporter is what feeds the coverage ratchet script.

**Self-contained by design**: the fast API suite mocks Prisma and Redis, so `pnpm --filter @repo/api test` (or `jest`) needs no Docker services running. This is why it's safe to run in the `quality`-gated pre-push hook and in CI without service containers, and why it's fast enough to run on every commit.

Run it:

```sh
pnpm --filter @repo/api test          # run once
pnpm --filter @repo/api test:watch    # watch mode
pnpm --filter @repo/api test:cov      # with coverage, no ratchet check
pnpm --filter @repo/api test:cov:check  # with coverage AND the ratchet gate (see below)
```

### Coverage ratchet (api)

`pnpm --filter @repo/api test:cov:check` runs `jest --coverage` then `node ../../scripts/check-coverage.mjs ./coverage/coverage-summary.json --lines 85 --functions 82`.

`scripts/check-coverage.mjs` is a **ratchet, not a wishlist**: it reads `total.lines.pct` / `total.functions.pct` from the json-summary report and fails the command if either metric falls below the floor passed on the command line (`--lines`/`--functions`, or `COVERAGE_MIN_LINES`/`COVERAGE_MIN_FUNCTIONS` env vars). The floors are hard-coded per-package in `package.json` scripts, not stored anywhere the script itself infers automatically, raising them is a manual edit to the `test:cov:check` script string as coverage climbs. The script's own comment is explicit: "Raise the floors as coverage climbs. Never lower them to silence a regression."

API floor: **85% lines / 82% functions**.

## Web tests (`apps/web`)

Vitest-based. Scripts (`apps/web/package.json`):

```sh
pnpm --filter @repo/web test            # vitest run (single pass)
pnpm --filter @repo/web test:watch      # vitest (watch mode)
pnpm --filter @repo/web test:cov        # vitest run --coverage
pnpm --filter @repo/web test:cov:check  # coverage + ratchet gate
```

`test:cov:check` runs `vitest run --coverage && node ../../scripts/check-coverage.mjs ./coverage/coverage-summary.json --lines 67 --functions 70`: the same ratchet script as the API, different floors.

Web floor: **67% lines / 70% functions**. This is the floor enforced in the pre-push hook and in CI's `test-web` job.

**Coverage-vs-hooks gotcha** (a real, previously-hit failure mode worth knowing): the web ratchet regresses when a `*.hooks.ts` file grows, because component tests typically mock the hook they consume rather than exercising it directly, so the hook's own lines never execute under test. The fix used in this repo is a dedicated `renderHook`-based `*.hooks.test.tsx` sibling for any hook file, not lowering the floor. See the commit `test(web): cover useFileUploadZone to restore coverage ratchet` for a worked example.

### Bundle size budget

`pnpm --filter @repo/web size:check` runs **two** budgets, because they answer different questions.

**1. Initial load (the gate that matters).** `scripts/check-initial-bundle.mjs` parses `dist/index.html`,
collects the entry module, every `<link rel="modulepreload">`, and every render-blocking
`<link rel="stylesheet">`, and sums their per-file brotli size. That set is what a browser fetches
before first paint. Limit: **225 kB**.

The stylesheet is counted deliberately: a plain `<link rel="stylesheet">` blocks paint outright, so a
JS-only measurement would leave out the asset with the most direct claim on first paint. It is counted
but not required, since a build is free to inline its CSS.

**2. Total app weight (a loose ceiling).** `size-limit` against `apps/web/.size-limit.json` sums every
emitted chunk (JS 500 kB, CSS 18 kB). Useful for catching a heavy dependency landing in a shared chunk, and for telling you WHICH kind of asset grew when the initial-load gate moves,
but it is deliberately NOT the primary gate.

**Why two, and why the second one is not the gate**: route-level code splitting is on
(`autoCodeSplitting` in the TanStack Router plugin), so the build emits 60+ chunks and no user downloads
more than a fraction of them. A `dist/assets/*.js` glob adds every route's chunk together and calls
the sum a regression, which means the number gets _worse_ every time a feature is split correctly. A large
feature can push the all-chunks sum far past a cap while the real initial load barely moves: a glob
budget measures a quantity nobody experiences.

The initial-load script fails closed on a shape change: if the document yields no `<script src>`, no
`modulepreload` set, or references a file the build did not emit, it errors instead of reporting a
comfortable number. A byte gate whose parser silently matches nothing passes forever, and that is invisible
precisely when it matters. It is covered by `apps/web/src/test/check-initial-bundle.test.ts`.

Both run after a production build in CI's `test-web` job (`Build web` step must complete first).

### Lighthouse budgets

`pnpm --filter @repo/web lighthouse` runs `lhci autorun` against `apps/web/lighthouserc.json`:

- `categories:accessibility`: hard assertion, min score 0.95.
- `categories:best-practices`: hard assertion, min score 0.90.
- `categories:seo`: hard assertion, min score 0.85.
- `categories:performance`: **warning only** (min score 0.80), not a hard gate, because perf scores are runner-dependent and there is no runner-stable baseline yet.

Lighthouse needs a real Chrome install and is **skipped under `act`** (`if: ${{ ... && !env.ACT }}` in `ci.yml`), the local `act` runner image lacks Chrome and its scores would be noise anyway. It still runs for real on every GitHub Actions run, which is the true-parity gate.

## E2E tests (Playwright)

Config: `apps/web/playwright.config.ts`. `testDir: './e2e'`, Chromium project only, `baseURL: http://localhost:5173`, trace on first retry, screenshot on failure, HTML + list reporters. In CI: `retries: 1`, `workers: 1`; locally: no retries, default worker count.

Three spec files today:

- `navigation.spec.ts`: landing page title, hero section, theme toggle, unauthenticated nav links, navigation to login/register, features section.
- `auth.spec.ts`: login/register page headings and form fields, empty-submit validation errors, redirect-to-login when unauthenticated, cross-navigation between login and register, back-to-home link.
- `auth-login.spec.ts`: **real login** against a seeded admin: logs in and reaches the authenticated dashboard, and rejects a wrong password with an error shown on the login page.

### How CI builds and runs it (the `vite --base=/` gotcha)

The web app's default Vite `base` is `'./'` (relative), which is required for the packaged Electron shell to load assets over `file://`. But `vite preview`'s SPA fallback serves `index.html` for any unmatched route (e.g. a deep link straight to `/auth/login`), and with a relative base the browser then resolves `./assets/*` against the _current URL path_, not the site root, so a deep-linked route 404s its JS/CSS.

CI's `test-e2e` job works around this by building web with an **absolute** base specifically for the e2e run:

```sh
pnpm exec turbo build --filter=@repo/api
pnpm --filter @repo/web exec vite build --base=/
```

This is a one-off `vite build --base=/` invocation, not the package's normal `build` script, the normal build (used for the Electron shell and for Docker/nginx deployment) keeps the relative base. Don't "fix" the default base to `/` globally; that would break the Electron packaged app instead.

Full e2e boot sequence in CI (`.github/workflows/ci.yml`, `test-e2e` job):

1. Postgres + Redis service containers.
2. `pnpm build:packages`, apply migrations (`db:migrate:deploy`).
3. Seed the admin user (`db:seed`) with `ADMIN_EMAIL=admin@example.com` / `ADMIN_PASSWORD=P@ssw0rd!Change.Me`: these **must** match the credentials `auth-login.spec.ts` logs in with.
4. Build the API via turbo, build web with `vite build --base=/`.
5. Cache + install Playwright Chromium (`actions/cache@v4` keyed on `@playwright/test` version).
6. Start the built API (`node apps/api/dist/src/main.js`) with dummy SMTP/S3/Turnstile/CSRF/metrics/encryption env vars (the e2e specs never exercise those transports), poll `GET /health` until it answers.
7. Start web via `vite preview --port 5173 --strictPort` (which proxies `/trpc` to `:3000`), poll until it answers.
8. Run `pnpm --filter @repo/web test:e2e` (`playwright test`).
9. On failure, upload the Playwright HTML report as a build artifact (7-day retention).

Running e2e locally: start the dev stack (`docker compose up -d`, `pnpm dev` or `./start.sh`), then `pnpm --filter @repo/web test:e2e`. The Playwright config's `webServer` auto-start block is present but commented out on purpose, this project's convention is to start dev servers manually first.

## Tenant isolation lane (live-DB integration tests)

This is the proof that the app-layer Prisma tenant-scope extension (`common/database/tenant-scope.extension.ts`) is a real isolation boundary, there is **no** Postgres Row-Level Security in SaaS Starter; the extension is the _only_ enforcement layer, and this test suite is what backs that claim.

Location: `apps/api/src/common/database/tenant-isolation.isolation.spec.ts`, run only via a dedicated config (`apps/api/jest.integration.config.js`) that targets exclusively `*.isolation.spec.ts` files, the fast `test` script ignores this file entirely (see the `testPathIgnorePatterns` above).

```sh
pnpm --filter @repo/api test:integration
```

`test:integration` sets `NODE_OPTIONS=--experimental-vm-modules` because the spec loads `@repo/database` via a native dynamic `import()` and jest needs that flag (it cannot be set from jest config). Requires a **real** `DATABASE_URL` reachable, export the repo's dev DB URL first if it isn't already the ambient value:

```sh
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
  && pnpm --filter @repo/api test:integration
```

The 11 named cases in the single `describe` block:

| ID  | What it proves                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Scoped `findMany` returns only the active tenant's rows                                                                                                                                 |
| T2  | Scoped `findUnique` by a cross-tenant id resolves to `null`                                                                                                                             |
| T3  | Scoped `findFirst` by a cross-tenant id resolves to `null`                                                                                                                              |
| T4  | Cross-tenant `update` by id mutates 0 rows (other tenant's row untouched)                                                                                                               |
| T4b | Cross-tenant `deleteMany` by id removes 0 rows                                                                                                                                          |
| T5  | `create` auto-stamps the active tenant id                                                                                                                                               |
| T8  | `update` cannot move a row to another tenant, a client-supplied `data.tenantId` is stripped                                                                                             |
| T9  | `create` ignores a client-supplied `tenantId` and stamps the active tenant instead                                                                                                      |
| T10 | `updateMany` cannot move rows to another tenant, `data.tenantId` is stripped                                                                                                            |
| T6  | Fail-closed: a scoped query with no tenant in context throws                                                                                                                            |
| T7  | The deliberate unscoped-client escape hatch: the unscoped client sees rows from **both** tenants (documents that this bypass exists and is intentional, for system/seed/CLI code paths) |

This lane is **not** currently run in GitHub Actions CI (it needs a live Postgres and is more expensive than the mocked fast suite); it is a local/manual integration gate today. Treat it as required before touching anything under `common/database/tenant-scope.extension.ts` or the request-context tenant plumbing.

## Committed test inventory (`pnpm verify:inventory`)

Every count above is a snapshot someone typed. The inventory is the machine-readable
version, and the only thing in the repo that notices when a test case stops existing.

The coverage ratchets move too little to see one deleted test, ESLint bans `.only` but
lets a tracked `.skip` through, and git's ort merge can interleave two branches'
adjacent test bodies with no conflict marker, which no runner notices. In all
three cases the suite still exits 0.

So every runner writes JUnit on every run (jest through `jest-junit`, vitest and
Playwright through their built-in reporters), `tools/verify/inventories/<suite>.json`
holds the committed baseline as `file -> fullName -> count`, and the comparison refuses
four things even when the suite is green:

| Reported     | Means                                                               |
| ------------ | ------------------------------------------------------------------- |
| `missing`    | a baseline case the run did not produce (deleted, renamed, lost)    |
| `unexpected` | a case the run produced that the baseline does not list             |
| `duplicate`  | the same `[file, fullName]` seen more often than the baseline says  |
| `skipped`    | the runner reported the case as skipped, whatever the baseline says |

```sh
pnpm verify:inventory                       # run the unit suites, then compare
pnpm verify:inventory --from-report         # compare the reports that are already there
pnpm verify:inventory --suite=web           # one suite (use --suite=e2e to run the e2e lane)
pnpm verify:inventory --accept              # write additions into the baselines
pnpm verify:inventory --accept --allow-removals   # write removals too
```

Exit codes match `pnpm verify`: 0 agreed, 1 disagreed, 2 could not check. `--allow-removals`
is a second flag on purpose: "this test is gone" is the claim the whole mechanism exists to
make someone say out loud. A skipped case is never acceptance material; `--accept` reports it
and still fails.

The nine suites are listed in `tools/verify/inventory-suites.ts`. The security lane is
deliberately absent: `apps/api/security-spec` is already reconciled case by case against
`findings.json` by `pnpm check:security`, which is a stricter version of the same check.

`pnpm verify --profile=feature` runs the comparison last, as the `inventory` check, over the
reports the suites above it just wrote. In `feature` the e2e suite is left uncompared (that
profile never boots a browser) and `release` includes it.

### The merge rule

```sh
pnpm verify:inventory --merge-audit          # HEAD
pnpm verify:inventory --merge-audit=<commit>
```

Run this on a merged tree. It reads the baselines out of git at the merge commit, both
parents and their merge base, and three-way merges the counts: whichever parent moved a case
is the value the merge should carry, and when both moved it differently either answer is
allowed because a human resolved it. Anything else appeared or vanished during the merge
itself, which is exactly what a silent interleave looks like from outside: two green
branches and one damaged tree. Re-resolve the merge; do not re-accept the baseline.

## What each CI job runs (quick cross-reference)

See [ci-cd.md](/operations/ci-cd/) in this same set for the full workflow breakdown. In test-specific terms:

- `quality`: lint, type-check, `lint:meta`, `check:lint-meta-docs`, `knip` (api + web), internal ESLint plugin's own Jest tests. No app-level unit tests here.
- `test-api`: applies migrations, checks migration status/drift, then `pnpm --filter @repo/api test:cov:check` (the fast Jest suite + the 85/82 ratchet). Postgres + Redis service containers present, but the tests themselves are self-contained (mocked), the services exist for the Prisma migration gates in the same job, not for the test run.
- `test-web`: `pnpm --filter @repo/web test:cov:check` (Vitest + 67/70 ratchet), then builds web and runs the bundle-size budget and (on real GitHub runners only) Lighthouse.
- `test-e2e`: the full Playwright run described above. Its "Start API" step is also the app boot smoke (it was a `boot-smoke` job of its own until it was folded in here): it asserts the **real built artifact** boots and answers `GET /health/ready`; see `ci-cd.md`.

All three test-ish jobs (`test-api`, `test-web`, `test-e2e`) are path-filtered on pull requests via `turbo --affected` probes (a `Detect affected (...)` step), they still run and report a status (so required checks are always green/red, never missing), but skip the expensive work when the PR doesn't touch the relevant package graph. Push and `workflow_dispatch` events always run everything.
