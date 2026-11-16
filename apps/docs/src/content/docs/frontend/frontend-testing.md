---
title: Frontend Testing
description: Vitest setup, the component-test-mocks-its-hook / dedicated hooks.test.tsx conventions, coverage ratchet thresholds, and pre-push enforcement.
sidebar:
  order: 6
---

## Vitest setup

Config: `apps/web/vitest.config.ts`.

```ts
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      exclude: ['src/test/**', 'src/routeTree.gen.ts', '**/*.stories.tsx'],
    },
  },
  resolve: { alias: { '@': ..., '@api': ... } },
});
```

- Environment is `happy-dom` (lighter/faster than `jsdom` for this suite).
- `json-summary` is required in the reporter list, it's what
  `scripts/check-coverage.mjs` (the ratchet, below) reads.
- `**/*.stories.tsx` and `src/routeTree.gen.ts` (generated) are excluded from
  coverage.

### Setup file (`apps/web/src/test/setup.ts`)

Imports `@testing-library/jest-dom/vitest` for the `toBeInTheDocument()`-style
matchers, and works around a Node v25+/Vitest 4 interaction: Node now ships a
non-functional built-in `localStorage`/`sessionStorage` stub on `globalThis`
which Vitest's global-population step does not overwrite (because the key
already exists). The setup file explicitly reinstalls `happy-dom`'s real
`Storage` implementation onto `globalThis.localStorage`/`sessionStorage` so
that Zustand's `persist` middleware (`useUIStore`) and any other
localStorage-touching code actually works under test instead of silently
no-op'ing.

```bash
pnpm --filter @repo/web test          # vitest run (single pass)
pnpm --filter @repo/web test:watch    # vitest (watch mode)
pnpm --filter @repo/web test:cov      # vitest run --coverage
pnpm --filter @repo/web test:cov:check # coverage run + ratchet check (see below)
```

## Component test convention: mock the component's own hook

Per the [feature folder architecture](/frontend/feature-folder-architecture/),
every component's state/data/mutations live in `<Name>.hooks.ts`, and
`<Name>.tsx` is a thin shell that calls exactly one view hook. The component
test (`<Name>.test.tsx`) exploits this split: it mocks the `./<Name>.hooks`
module so the rendered component is deterministic and fully offline (no
TanStack Query network calls, no Electron bootstrap needed), and asserts only
on rendered output.

Example, `apps/web/src/features/shared/components/FileUploadZone/FileUploadZone.test.tsx`:

```ts
vi.mock('./FileUploadZone.hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./FileUploadZone.hooks')>();
  return {
    ...actual,
    useFileUploadZone: () => ({
      isDragOver: false,
      uploads: state.uploads,
      // ...every other view-model field, hand-authored...
    }),
  };
});
```

Note the `importOriginal` + spread: this keeps any **pure, non-hook exports**
from the same file real (here, `buildPresignedPostFormData`, a plain
FormData-building helper that the test also unit-tests directly) while
stubbing out only the stateful `use*` function.

`LoginForm.test.tsx` is a lighter-weight version of the same idea: it doesn't
need to mock `LoginForm.hooks.ts` at all (the hook's own dependencies ,
`@tanstack/react-query`, `@tanstack/react-router`: are mocked instead, at the
`vi.mock('@tanstack/react-router', ...)` level), because rendering the real
hook with a fresh, unpopulated `QueryClient` is already deterministic enough
for an assertion like "the email input renders."

## Hooks test convention: dedicated `*.hooks.test.tsx` with `renderHook`

**The gotcha this convention exists to fix:** because component tests mock
their own `<Name>.hooks.ts` module (above), a hook file with real branching
logic (validation, retry/dedupe logic, optimistic-update rollback, XHR
progress handling, ...) gets **zero test coverage** from the component test ,
the mock replaces the entire hook body. As a hooks file grows, this silently
drags down the project's function/line coverage even though the component
"looks tested."

The fix is a **second, dedicated test file**: `<Name>.hooks.test.tsx`: that
imports the **real** hook and drives it directly via
`@testing-library/react`'s `renderHook`, with the hook's own dependencies
(tRPC, XHR, timers) faked at the lowest possible layer instead of mocking the
hook itself.

Reference implementation:
`apps/web/src/features/shared/components/FileUploadZone/FileUploadZone.hooks.test.tsx`.
Key techniques used there, applicable to any new `*.hooks.test.tsx`:

- Mock only `@/lib/trpc` (the network boundary), not the hook:
  ```ts
  vi.mock('@/lib/trpc', () => ({
    trpc: {
      storage: { requestUpload: { mutationOptions: () => ({ mutationFn: requestUploadFn }) } },
    },
  }));
  ```
- Fake browser APIs the hook depends on (here, `XMLHttpRequest`, because
  upload progress needs it, `fetch` cannot report progress events) with a
  minimal class stubbed via `vi.stubGlobal`.
- Wrap `renderHook` in a real `QueryClientProvider` (a fresh `QueryClient` per
  test, mutations non-retrying) so `useMutation`/`useQuery` work exactly as
  they do in production.
- Drive the hook through its **public API** (e.g.
  `result.current.handleInputChange(...)`), not by reaching into private
  state, so the test exercises the same path a real user interaction would.
- Assert on both the returned view-model (`result.current.uploads[0].status`)
  and on side-effect callbacks (`onUploadComplete`, `onUploadError`) via
  `waitFor`.

**When to add one:** any time a `.hooks.ts` file has real logic beyond
plumbing a query/mutation straight through (validation, dedupe, rollback,
progress/async orchestration, timers), not for every hook file
mechanically. A hook that's a one-line `useQuery(trpc.x.y.queryOptions())`
wrapper doesn't need its own test file; the component test already exercises
it end-to-end via the mock's shape matching reality.

## Storybook

Both `apps/web` (`.storybook/main.ts`, stories under
`src/**/*.stories.tsx`) and `packages/ui` ship separate Storybook instances
(see the [UI package doc](/frontend/ui-package/)). Every feature component's
`<Name>.stories.tsx` is required by `component-folder-structure`, so
Storybook coverage is structurally guaranteed, not opt-in.

```bash
pnpm --filter @repo/web storybook           # dev server, port 6007
pnpm --filter @repo/web build-storybook     # static build
```

## E2E tests (Playwright)

`apps/web/e2e/` (`playwright.config.ts`): `auth.spec.ts` (page-render
smoke checks), `auth-login.spec.ts` (a real login against a seeded admin
user, asserting the httpOnly `__Host-session_id` cookie and gated
`user.me`-backed dashboard content), `navigation.spec.ts`. These require the
API + Postgres + Redis stack running (`docker compose up -d`, then `pnpm
dev`), there is no `webServer` auto-start block wired in
`playwright.config.ts` (deliberately commented out, "not recommended in this
project").

```bash
pnpm --filter @repo/web test:e2e       # playwright test
pnpm --filter @repo/web test:e2e:ui    # playwright test --ui
```

## Coverage ratchet: 67% lines / 70% functions

`scripts/check-coverage.mjs` (repo root) is a **ratchet, not a wishlist**: it
reads a `coverage-summary.json` (the vitest `json-summary` reporter's
output, the same shape jest emits, so the script is runner-agnostic) and
fails if `total.lines.pct` or `total.functions.pct` falls below a floor
passed on the command line. The floors only ever go up as coverage improves;
the script's own header comment states explicitly: "Raise the floors as
coverage climbs. Never lower them to silence a regression."

`apps/web/package.json`'s `test:cov:check` script wires the current floors:

```bash
vitest run --coverage && node ../../scripts/check-coverage.mjs ./coverage/coverage-summary.json --lines 67 --functions 70
```

At the time of writing, `apps/web/coverage/coverage-summary.json` reports
lines 79.47%, functions 76.78%, statements 78.42%, branches 66.12%, both
ratcheted metrics comfortably clear their floors; branches/statements are not
gated by the script (only lines and functions are).

`apps/api` has its own equivalent `test:cov:check` script with its own floors
(not covered by this document, see the backend docs).

## Pre-push enforcement

`.husky/pre-push` runs `bash scripts/ci/pre-push.sh`, which mirrors
`.github/workflows/ci.yml` gate-for-gate (enforced by the `pre-push-ci-parity`
lint-meta rule, so the two cannot silently drift). Relevant to frontend
testing specifically:

```bash
# Fast checks (always run, no services needed)
pnpm exec turbo lint
pnpm exec turbo check-types
pnpm --filter @repo/web knip

# Coverage ratchet (self-contained: api/web suites mock their own
# Prisma/Redis/network dependencies, so no live DB/Redis is required here)
pnpm --filter @repo/api test:cov:check
pnpm --filter @repo/web test:cov:check
```

If `pnpm --filter @repo/web test:cov:check` fails locally, the fix is almost
always one of:

1. A new/changed `.hooks.ts` file gained branching logic that its component
   test's mock skips entirely, add a dedicated `*.hooks.test.tsx` (see
   above) rather than trying to coax more coverage out of the component test.
2. A genuinely untested code path, write a real test for it.

**Never** lower the `--lines`/`--functions` numbers in `test:cov:check` to
make the ratchet pass; per the script's own doc comment, that defeats its
purpose. The Prisma-dependent gates further down `pre-push.sh`
(`db:migrate:check`, `db:migrate:status`) skip cleanly when no database is
reachable on `localhost:5432` (`PRE_PUSH_SKIP_DB=1` forces the skip); they are
unrelated to frontend coverage.

## Other frontend CI gates (brief, not test-suite related)

Two additional web-specific gates exist alongside the test suite, run in CI
but not through `vitest`:

- **Bundle size** (`pnpm --filter @repo/web size:check`) runs two budgets: the
  gating one is `scripts/check-initial-bundle.mjs`, which weighs what a browser
  fetches before first paint (entry, its `modulepreload` set, and the
  render-blocking stylesheet, 225 kB brotli); `apps/web/.size-limit.json` keeps
  looser per-type ceilings for all emitted JS (500 kB) and CSS (18 kB), which
  say WHICH kind of asset grew when the gate moves. See the testing-strategy doc for why the
  all-chunks number is not the gate.

  What keeps that number down is mostly one line of `apps/web/vite.config.ts`:
  `codeSplittingOptions.defaultBehavior` adds `pendingComponent` to the router
  plugin's default split set. Both layout routes draw their FULL chrome while
  they wait, so the default groupings (which split `component`,
  `errorComponent` and `notFoundComponent` but not `pendingComponent`) put the
  authenticated app shell in front of every visitor, including the
  sign-in screen that renders neither. That was 60 kB brotli.
  `apps/web/src/test/shell-split.bundle.test.ts` fails if the option is
  removed.

- **Lighthouse CI**: `apps/web/lighthouserc.json` (`pnpm --filter @repo/web
lighthouse`, via `lhci autorun`).

Both are configuration-only checks (no test files to write against), included
here only so they aren't confused with the Vitest coverage ratchet above when
diagnosing a red pre-push/CI run.
