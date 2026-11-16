---
title: Build System and Developer Experience
description: Turbo pipeline, pnpm conventions, codegen, the custom ESLint infrastructure, git hooks, and commit conventions.
sidebar:
  order: 2
---

## Turbo pipeline

`turbo.json` at the repo root defines the task graph. Turborepo runs tasks per workspace package and caches their outputs; the important tasks are:

| Task                                              | `dependsOn`                                        | Notes                                                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db:generate`                                     | none                                               | `prisma generate`, keyed on `packages/database/prisma/schema/**/*.prisma` and `DATABASE_URL`, never cached                                                                              |
| `@repo/api#generate:trpc`                         | `^build`                                           | Runs `nestjs-trpc generate`, writing `apps/api/src/@generated/server.ts`. Inputs are every `src/**/*.ts` file except the generated output itself, so any router/schema change reruns it |
| `build` (default)                                 | `^build`, `db:generate`                            | Generic build task every package falls back to                                                                                                                                          |
| `@repo/api#build`                                 | `^build`, `db:generate`, `@repo/api#generate:trpc` | The API cannot build without a fresh generated tRPC file                                                                                                                                |
| `@repo/web#build`                                 | `^build`, `@repo/api#generate:trpc`                | The web app's `tsc -b` step needs `AppRouter` to type-check, so it depends on the API's generation step even though there is no package dependency between them                         |
| `@repo/web#check-types` / `@repo/api#check-types` | same as above                                      | Same reasoning for `tsc --noEmit` runs                                                                                                                                                  |
| `@repo/web#lint`                                  | `^build`, `@repo/api#generate:trpc`                | ESLint's type-aware rules need the generated file to resolve                                                                                                                            |
| `dev`                                             | `^build`                                           | Not cached, `persistent: true` (long-running dev servers)                                                                                                                               |
| `lint` / `check-types`                            | `^build`                                           | Default fallbacks                                                                                                                                                                       |
| `@repo/eslint-plugin-repo#lint`                   | `^build`, `build`                                  | The plugin lints itself after building, since `dist/` must exist for its own rule tests                                                                                                 |
| `test` / `test:e2e`                               | `^build`                                           | Never cached (`cache: false`)                                                                                                                                                           |

`globalEnv` in `turbo.json` lists every environment variable that can affect a cached task's output hash (things like `NODE_ENV`, `API_URL`, `SENTRY_DSN`); if a task's output depends on an env var not listed there, Turbo's cache would go stale silently, so new env vars that affect build output must be added here.

### Root pnpm scripts (from `package.json`)

```bash
pnpm dev                 # turbo dev --filter=!@repo/desktop (web + api, hot reload)
pnpm build               # turbo build (every package, respecting the graph above)
pnpm build:packages      # turbo build --filter=./packages/*  (packages only, used by CI's quality job)
pnpm lint                # turbo lint
pnpm lint:fast           # turbo lint:fast --filter=@repo/web  (LOCAL ONLY, cached)
pnpm check-types         # turbo check-types
pnpm test                # turbo test
pnpm test:e2e            # turbo test:e2e

pnpm desktop:dev         # pnpm --filter @repo/desktop dev
pnpm desktop:package     # electron-builder package (see environments-and-config.md)

pnpm lint:meta           # tsx tools/lint-meta/cli.ts  (custom meta-rules, see below)
pnpm lint:meta:verify    # --verify mode
pnpm lint:tools          # eslint tools          (the harness is product code, so it is linted)
pnpm check-types:tools   # tsc -p tools/tsconfig.json
pnpm test:lint-meta      # every test under tools/ plus the Claude Code edit hooks
pnpm new:feature         # tsx tools/codegen/new-feature.ts
pnpm new:component       # tsx tools/codegen/new-component.ts
pnpm new:finding         # tsx tools/codegen/new-finding.ts   (a security-spec finding)

# The verification harness. See operations/verification-harness.md for all of it.
pnpm verify              # the gate: --profile=static|feature|release, exits 0 / 1 / 2 blocked
pnpm verify:inventory    # compare the suites against tools/verify/inventories/
pnpm sandbox:up          # this worktree's private postgres/redis/s3/mailpit on random ports
pnpm sandbox:down        # and remove them again
pnpm e2e:lane            # Playwright against servers this lane owns
pnpm check:security      # reconcile apps/api/security-spec against findings.json
pnpm canary:isolation    # mutate the tenant boundary and require the isolation lane to fail

pnpm ci:local            # bash scripts/ci-local.sh -j quality   (runs CI locally via nektos/act)
pnpm ci:local:all        # full local CI run, job by job (see docs/local-ci.md)
```

### The local-only fast loop

`pnpm lint:fast` is `eslint . --cache --cache-location node_modules/.cache/eslint/ --cache-strategy content` for `@repo/web`. It exists because the package you just edited always pays the full cost: Turbo caches `lint` per package, so it only saves the packages that did not change.

It is a separate script rather than a flag on `lint` on purpose. ESLint keys a cached result on the linted file's content and on the resolved config, and on nothing else, so a rule that READS another file can return a stale verdict. Two web rules do: `contracts/translation-key-exists` reads the English catalogs, and `architecture/component-folder-structure` checks that a component's sibling files exist. `apps/web/eslint.config.js` folds the catalogs' content and the list of paths under `src/` into `settings`, which is part of the config and therefore part of the cache key: deleting a catalog key or a sibling file re-lints everything. `scripts/lint-cache-web-digest.test.mjs` proves both, including that the cache goes stale without the digest.

The api has no cached lint at all, and that is deliberate. Its type-aware block reads other files through the type checker: `noctcore-prisma/mutation-entry-must-reach-audit` follows calls across files, so deleting the audit call in a service leaves the unchanged router cached clean. No digest short of hashing all of `apps/api/src` can fix that, and hashing all of it leaves nothing to cache. `scripts/lint-cache-api-uncached.test.mjs` shows that stale green and fails if an api `--cache` script comes back.

CI and `scripts/ci/pre-push.sh` lint cold, and `tools/verify/typecheck-cache.test.ts` fails if `--cache` or `lint:fast` ever appears in either.

Type checking is cached differently and unconditionally: every `check-types` config sets `incremental` beside its `tsBuildInfoFile` (the web and package configs named the file for years without the flag, so `tsc --noEmit -p` ignored it). tsc's buildinfo records file versions and the reference graph, so a warm run still reports an error introduced in an imported file, which the same test pins.

Turbo path filtering with `--affected` only works when invoked directly through `turbo` (e.g. `pnpm exec turbo lint --affected`), not by forwarding `-- --affected` through a `pnpm <script>` call: the flag gets forwarded to the underlying tool (eslint/tsc), which rejects it. `.github/workflows/ci.yml` always calls `pnpm exec turbo <task> $TURBO_AFFECTED` directly for this reason. `--affected` also pulls in downstream _dependents_: a change scoped to `apps/api` still selects `@repo/web#check-types` because of the `generate:trpc` dependency above, so the type-safety gate always fires even on backend-only changes.

## pnpm workspace conventions

- **`workspace:*` protocol.** Every internal dependency between apps/packages uses `"workspace:*"` in `package.json` (see `monorepo-overview.md`'s dependency table), never a version range.
- **`packageManager` pin.** `"packageManager": "pnpm@10.33.2"` at the root; CI's `pnpm/action-setup` steps pass the same version explicitly.
- **`onlyBuiltDependencies`.** The root `package.json`'s `pnpm.onlyBuiltDependencies` allowlists the packages permitted to run native postinstall/build scripts (`@nestjs/core`, `@swc/core`, `@prisma/engines`, `prisma`, `esbuild`, `electron`): pnpm otherwise blocks arbitrary install scripts by default for supply-chain safety.
- **`pnpm.overrides`.** A long list of transitive-dependency version pins, mostly CVE remediations (e.g. `minimatch`, `brace-expansion`, `tar`, `undici`, `esbuild`) pulled from Dependabot alerts. When bumping a top-level dependency, check whether an override for one of its transitive deps is still needed.
- **`postinstall`.** `node scripts/fix-trpc-native-perms.mjs`: a workaround for `nestjs-trpc`'s native binary losing its executable bit after install.
- **`prepare`.** `husky`: installs the git hooks described below.

## Codegen tools (`tools/codegen/`)

Two generator scripts, both run via `tsx` and both reject if the target already exists:

- **`pnpm new:feature <Name>`** (`tools/codegen/new-feature.ts`) scaffolds a new domain folder under `apps/web/src/features/<kebab-name>/`: `<Name>.types.ts`, `<Name>.queries.ts`, `<Name>.mutations.ts`, `<Name>.constants.ts`, `locales/en.json` and `<Name>.i18n.ts` (the namespace registration plus its `<SCREAMING_SNAKE>_NS` export). The generated queries/mutations files follow the repo's own data-access convention: they call `trpc.<router>.<procedure>.queryOptions()` / `.mutationOptions()` from the option-proxy client (see `type-safety-chain.md`), never a hand-written query key.
- **`pnpm new:component <feature>/<Name>`** (`tools/codegen/new-component.ts`) has two modes:
  - `<feature>/<Name>` scaffolds the six-file component-folder convention (see below) under `apps/web/src/features/<feature>/components/<Name>/`. Fails if the feature folder doesn't exist yet (create it with `new:feature` first).
  - `ui/<Name>` scaffolds a single flat file under `packages/ui/src/components/<kebab-name>.tsx` (shadcn convention) and also patches `packages/ui/package.json`'s `exports` map to add the new subpath: this is the one piece of codegen that mutates an existing file rather than only creating new ones.

### The generators are tested by running them

`tools/codegen/codegen.test.ts` generates a feature, a feature component and a ui component
under a random free name, then runs ESLint, `tsc --noEmit`, `pnpm lint:meta` and the
generated component's own test over the result, and cleans up in `finally`. It runs under
`pnpm test:lint-meta`.

A generator is documentation that has to compile, and these encode conventions that keep
moving: the tRPC option proxy, `pathKey()` invalidation, `route-i18n-side-effect`
placement and the `no-hardcoded-ui-strings` scope. Writing the test immediately found a
real defect - a temporal dead zone `ReferenceError` that made `pnpm new:component` throw
before it wrote a single file.

## Frontend component-folder convention (enforced by lint)

Every component under `apps/web/src/features/<domain>/components/<Name>/` must have exactly this sibling set (documented in `apps/web/src/features/README.md`):

```
LoginForm/
  LoginForm.tsx          # thin presentational shell (default export)
  LoginForm.hooks.ts     # all state, effects, tRPC queries/mutations, store reads
  LoginForm.types.ts     # I-prefixed interfaces
  LoginForm.stories.tsx  # Storybook story
  LoginForm.test.tsx     # component test
  index.ts               # barrel re-exporting the default + types
```

This is enforced, not a convention developers can silently drift from. Eight ESLint rules in `@repo/eslint-plugin-repo`, wired at `error` severity via `@repo/eslint-config/react-architecture`, gate it:

| Rule                          | What it blocks                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `component-folder-structure`  | Missing sibling file in the set above                                                                                                          |
| `no-cross-feature-imports`    | Importing across two sibling domains (e.g. `settings` reaching into `auth`); shared code must live in `features/shared`                        |
| `max-hooks-per-file`          | More than four `use*` exports in one hooks file                                                                                                |
| `no-state-in-component-body`  | `useState`/`useEffect`/`useQuery`/`useMutation`/`use*Store` called directly inside `<Name>.tsx` instead of the hooks file                      |
| `no-jsx-computation`          | `.map`/`.filter`/arithmetic/chained `&&` inline inside returned JSX instead of lifted to a `const`                                             |
| `props-must-be-visual`        | A prop shaped like a secret (`token`, `userId`, `sessionId`); read those from the route/store inside the hook instead of passing them as props |
| `index-must-reexport-default` | Barrel not re-exporting the default + types                                                                                                    |
| `interface-prefix-i`          | Interface not prefixed `I` (also enforced in `@repo/ui`, which is otherwise exempt from the rest of this rule set)                             |

`src/routes/`, `src/stores/`, and `src/lib/` are deliberately not gated by these structural rules: routes stay thin (`createFileRoute` rendering a feature component) and the rest is plumbing.

## ESLint infrastructure

- **`@repo/eslint-plugin-repo`** (`packages/eslint-plugin-repo/src/rules/`) holds only the rules with no published home yet: the queue trio (`processor-must-extend-traced-worker-host`, `queue-add-must-wrap-job-context`, `job-name-must-be-constant`) and the web rules (`no-hardcoded-ui-strings`, `no-native-date-input`, `effect-fired-mutation-must-bind-callbacks`, `trpc-invalidate-with-path-key`). Every other rule comes from a published `@noctcore/eslint-plugin-*` package: the Prisma tenancy, transaction, single-writer and audit-placement rules from `@noctcore/eslint-plugin-prisma`, the comment, clock and naming rules from `-code-quality`, and so on. `packages/eslint-plugin-repo/src/configs/recommended.ts` documents the default severity for the local rules; path-scoped ones ship `'off'` in the flat `recommended` map because a flat map cannot express directory scoping: they are actually turned on per-directory in `@repo/eslint-config/react-architecture.js` and `@repo/eslint-config/nestjs.js`.
- **`@repo/eslint-config`** (`packages/eslint-config/`) exposes four presets other packages extend from their own `eslint.config.js`: `./base`, `./react`, `./react-architecture`, `./nestjs`.
- Both packages are built with `tsup`; the plugin ships ESM + CJS + `.d.ts` (`tsup src/index.ts --format esm,cjs --dts --clean`) so it works regardless of which module system the consuming `eslint.config.js` runs under.

## Lint-meta (`tools/lint-meta/`)

A second, independent linter that runs against config, CI files and cross-file invariants
rather than application source: "lint the linters and the pipeline itself." ESLint sees one
file at a time; these rules exist for the things that are only wrong in relation to
something else, such as a Prisma model that no tenant registry mentions, or a gate in CI
that the pre-push hook does not run.

Invoked with `pnpm lint:meta`. `pnpm generate:lint-meta-docs` / `pnpm check:lint-meta-docs`
keeps `tools/lint-meta/RULES.md` in sync, and **that generated file is the rule list**. It
is regenerated from `tools/lint-meta/registry.ts` and checked in CI, so it cannot go stale
the way a list typed into this page would. Read it there, by category: `config`, `ci`,
`source-text`, `testing`, `supply-chain`.

Three properties are worth knowing before you add a rule:

- **`tools/` is itself scanned.** The text rules read their own definitions, so a rule must
  be able to tell its subject from its own source. `no-inline-lint-disable` and
  `no-ts-ignore` only count a match that OPENS a comment;
  `queue-registration-through-helper` only counts one that survives with comments and
  string bodies blanked. Neither uses an allowlist, and neither should.
- **Every registered rule needs a test that expects a violation.** The
  `lint-meta-rules-self-covered` rule enforces it. A guardrail with a false negative is
  worse than none, because it is trusted: if a refactor made `session-epoch-captured` return
  an empty array, every push would stay green while the revocation race it exists for
  came back.
- **`ciCritical`** marks the rules that must never be downgraded. The runner
  (`@noctcore/harness`) exits non-zero on any violation today, so the flag records intent
  for the day a rule's severity becomes configurable.

The harness is treated as product code: `pnpm lint:tools`, `pnpm check-types:tools` and
`pnpm test:lint-meta` all run in the `quality` CI job.

## Git hooks (Husky) and lint-staged

`.husky/` wires three hooks:

- **`pre-commit`**: builds `@repo/eslint-plugin-repo` first, then runs `npx lint-staged`. This ordering matters: lint-staged invokes `eslint --fix` directly (not through Turbo), so Turbo's `^build` dependency never fires and a stale `dist/` in the plugin would make `eslint --fix` run old rule code.
- **`commit-msg`**: `npx --no -- commitlint --edit $1`: validates the commit message against `commitlint.config.cjs`.
- **`pre-push`**: `bash scripts/ci/pre-push.sh`: a local approximation of the CI quality gate, run before every push.

`.lintstagedrc.json`:

```json
{
  "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml,css}": ["prettier --write"]
}
```

## Commit conventions

`commitlint.config.cjs` extends `@commitlint/config-conventional` with a restricted scope enum:

```js
'scope-enum': [2, 'always', [
  'api', 'web', 'desktop', 'ui', 'shared', 'database', 'email',
  'config', 'deps', 'auth', 'audit', 'observability',
]]
```

So every commit message must be `type(scope): subject` with `scope` drawn from that list (`scope-empty` is only a warning, not a hard error). Example: `feat(api): add tenant-scoped invoice list`.

## Local CI (`nektos/act`)

`pnpm ci:local*` scripts (`scripts/ci-local.sh`) run the GitHub Actions workflows locally via `act`. `pnpm ci:local:list` lists jobs (`act -l`); `pnpm ci:local:all` loops through every job. See `docs/local-ci.md` for the full setup, including a `nestjs-trpc` native-binary permissions fix needed under `act`.
