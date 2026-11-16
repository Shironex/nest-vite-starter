---
title: CI/CD
description: Every GitHub Actions workflow, the quality gates each one enforces, local CI via act, and the husky hook inventory.
sidebar:
  order: 3
---

:::note
CI is one consumer of the verification harness, not its definition. The same checks
run locally through `pnpm verify` and on push through `scripts/ci/pre-push.sh`; see
[Verification Harness](/operations/verification-harness/).
:::

## Workflows

There are exactly two workflow files in `.github/workflows/`:

- `ci.yml`: the main build/test/quality pipeline.
- `security-secrets.yml`: gitleaks secret scanning.

Both trigger on `push`/`pull_request` to `main` plus `workflow_dispatch`; `security-secrets.yml` also runs on a weekly schedule (`17 6 * * 1`, Monday 06:17 UTC) so a secret can be caught even in a week with no pushes. Both declare least-privilege `permissions: { contents: read }` at minimum. Dependabot pull requests run them like any other pull request.

### `ci.yml` jobs

| Job        | Depends on | Purpose                                                               | Path-filtered on PRs? |
| ---------- | ---------- | --------------------------------------------------------------------- | --------------------- |
| `quality`  | -          | Lint, type-check, lint-meta rules, knip, internal ESLint plugin tests | No, always full       |
| `audit`    | -          | `pnpm audit --prod --audit-level=high`                                | No                    |
| `build`    | `quality`  | `turbo build` across the graph                                        | Yes (`--affected`)    |
| `test-api` | `quality`  | Migration gates + API Jest suite + coverage ratchet                   | Yes                   |
| `test-web` | `quality`  | Vitest + coverage ratchet + bundle size + Lighthouse                  | Yes                   |
| `test-e2e` | `quality`  | Playwright against the real built api+web, and the app boot smoke     | Yes                   |

Concurrency: `group: ${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`: a new push to the same ref cancels the in-flight run for that ref.

Turbo path filtering: `TURBO_AFFECTED` is set to `--affected` only on `pull_request` events (empty on `push`/`workflow_dispatch`, so pushes to `main` always run the full graph). `TURBO_SCM_BASE` is the PR's base SHA, and every checkout uses `fetch-depth: 0` so that SHA is always reachable and `--affected` never errors on a missing ref. The three expensive jobs (`test-api`, `test-web`, `test-e2e`) additionally run a `Detect affected (...)` probe step (`scripts/ci/affected.sh`, unit-tested in `tools/verify/affected.test.ts`) that dry-runs the relevant turbo task and skips the heavy work (but still reports a green status) when the PR doesn't touch that package's dependency graph, any probe failure defaults to **running** the job (fail-safe), never to skipping it.

#### `quality` (Lint & Type Check)

Steps: checkout (full history), pnpm 10.33.2 + Node 22 setup, `pnpm install --frozen-lockfile`, `pnpm build:packages`, then:

```sh
pnpm exec turbo lint $TURBO_AFFECTED
pnpm exec turbo check-types $TURBO_AFFECTED
pnpm lint:meta
pnpm check:lint-meta-docs
pnpm --filter @repo/api knip
pnpm --filter @repo/web knip
pnpm --filter @repo/eslint-plugin-repo test
```

Note the direct `turbo` invocation rather than `pnpm lint -- --affected`: `turbo` must parse `--affected` itself; forwarding it through a `pnpm` script would hand the flag to eslint/tsc instead, which reject it.

`pnpm lint:meta` runs the repo's own custom meta-linter (`tools/lint-meta/cli.ts`), a second-order rule engine that checks things ESLint/tsc structurally cannot. The full rule catalog (`tools/lint-meta/RULES.md`, regenerated via `pnpm generate:lint-meta-docs`):

| Rule ID                           | Category    | CI-critical | What it guards                                                                               |
| --------------------------------- | ----------- | ----------- | -------------------------------------------------------------------------------------------- |
| `eslint-config-no-warn`           | config      | no          | ESLint severities must be `"error"` or `"off"`, never `"warn"`                               |
| `eslint-override-paths-exist`     | config      | no          | Literal file paths in `eslint.config.*` overrides must exist on disk                         |
| `env-cascade-drift`               | config      | no          | Every Joi env-schema key must be documented in `.env.example`                                |
| `no-inline-lint-disable`          | source-text | no          | Source files must not contain inline `eslint-disable` directives                             |
| `no-ts-ignore`                    | source-text | no          | Source files must not contain `@ts-ignore` / `@ts-expect-error`                              |
| `skipped-tests-need-tracking`     | testing     | no          | Skipped tests (`.skip`/`.fixme`/`xit`/`xdescribe`) must carry an issue URL or `TODO(@owner)` |
| `routes-require-test-sibling`     | testing     | **yes**     | Every `nestjs-trpc *.router.ts` needs a co-located `*.router.spec.ts`                        |
| `github-actions-permissions`      | ci          | no          | Every workflow must declare a top-level `permissions` block                                  |
| `github-actions-timeout-required` | ci          | no          | Every job must declare `timeout-minutes` (reusable-workflow calls exempt)                    |
| `launch-path-parity`              | ci          | **yes**     | `apps/api`'s launch path (package.json/Dockerfile/CI) must match the emitted entrypoint      |
| `pre-push-ci-parity`              | ci          | **yes**     | Every command in the pre-push manifest must appear verbatim in `ci.yml`                      |

`check:lint-meta-docs` (`pnpm generate:lint-meta-docs --check`) fails the build if `RULES.md` is stale relative to the registry, the table above is generated, not hand-maintained.

`knip` runs per-app (`@repo/api`, `@repo/web`) to catch unused exports/files/dependencies; each app has its own `knip.json` with targeted ignores for intentional cases (e.g. placeholder hooks kept for structural symmetry, see the audit doc's "bonus fixes" note about `FormError`/`FormSuccess`).

#### `audit` (Dependency Audit)

`pnpm audit --prod --audit-level=high`: fails on any high/critical production-dependency vulnerability. Runs independently of `quality` (no `needs`), so it can report even if lint/types are red.

#### `build`

`pnpm exec turbo build $TURBO_AFFECTED` with a dummy `DATABASE_URL` (Prisma's `prisma.config.ts` requires `DATABASE_URL` to be set even for `prisma generate`, which runs as a turbo dependency of build/lint/check-types/test, the workflow-level env var is a placeholder connection string that's never actually dialed for this job).

#### `test-api` (API Tests)

Real Postgres 17 + Redis 7 service containers. After the affected-probe and `pnpm build:packages`:

1. **Gate A, apply + verify migrations**: `db:migrate:deploy` then `db:migrate:status`, both against the live test DB.
2. **Gate B, schema-vs-migrations drift**: `db:migrate:check`. Prisma 7 removed `migrate diff --to-schema-datamodel` (now `--to-schema`) and `--from-migrations` needs a shadow database (a live DB), so a no-DB "does the schema match the migrations folder" check is not possible anymore. The workaround here diffs the now-migrated live DB against the schema folder using `--from-config-datasource --to-schema ... --exit-code`. **Caveat:** if this reports drift on what looks like a clean schema, suspect Prisma introspection drift on something the schema cannot express (the baseline's hand-appended partial indexes are the usual suspect) rather than an actual mismatch, and investigate before assuming the gate is wrong.
3. **Coverage ratchet**: `pnpm --filter @repo/api test:cov:check` with `DATABASE_URL`, `REDIS_URL`, and a CI-only synthetic `ENCRYPTION_KEY` (the same value gitleaks explicitly allowlists, see the security posture doc).

#### `test-web` (Web Tests & Budgets)

After the affected-probe: `pnpm --filter @repo/web test:cov:check`, then `pnpm exec turbo build --filter=@repo/web` (through turbo so the `@repo/api#generate:trpc` dependency fires, web's typecheck needs the generated tRPC client), then `pnpm --filter @repo/web size:check` (two byte budgets: the gating initial-load measurement from `scripts/check-initial-bundle.mjs`, plus a looser all-chunks ceiling from `size-limit`, see testing-strategy for why they are separate), then Lighthouse (`pnpm --filter @repo/web lighthouse`, **skipped under `act`** via `if: ${{ ... && !env.ACT }}` since the local runner image has no Chrome and perf scores are runner-dependent anyway, it still runs on every real GitHub Actions run).

#### `test-e2e` (E2E Tests)

Real Postgres + Redis. Applies migrations, seeds the admin (`ADMIN_EMAIL=admin@example.com` / `ADMIN_PASSWORD=P@ssw0rd!Change.Me`: must match what `apps/web/e2e/auth-login.spec.ts` logs in with), builds the API via turbo and builds web with `vite build --base=/` (see the testing-strategy doc for why the absolute base is required only for this preview-served run, not the normal Electron-targeted build), installs Playwright Chromium (cached by `@playwright/test` version), starts both the built API and `vite preview`, waits for both to answer, runs `pnpm --filter @repo/web test:e2e`, and uploads the Playwright HTML report as a build artifact on failure (7-day retention).

The API is started with a battery of synthetic env vars (dummy SMTP/Turnstile/CSRF/metrics-auth/encryption-key/S3) because the e2e specs never actually exercise those transports, but the Joi validation schema requires them all to be present to boot at all under `NODE_ENV=production`.

The "Start API" step is also the **app boot smoke**, which used to be a job of its own (`boot-smoke`): it boots the **real built entrypoint**: `node apps/api/dist/src/main.js`: against live Postgres+Redis and waits for `GET /health/ready`, printing the boot log and failing the job if the process dies or never answers. That catches two classes of defect unit tests cannot see: a DI wiring failure that aborts Nest's bootstrap silently, and a wrong launch path (`MODULE_NOT_FOUND` because the built artifact moved but nothing referencing it was updated). The `launch-path-parity` lint-meta rule statically guards the path references (package.json script, Dockerfile `CMD`, this CI step); this step is the dynamic proof that the built artifact actually starts. Its affected probe carries `--filter=@repo/api` alongside `--filter=@repo/web` for that reason: `@repo/web` has no package dependency on the api, so an api-only PR would otherwise skip the boot proof entirely.

### `security-secrets.yml`

Single job, `gitleaks`. Installs a **pinned** gitleaks binary by explicit version + SHA-256 checksum (`GITLEAKS_VERSION: '8.30.1'`, verified against the release tarball, not `uses: gitleaks/gitleaks-action` off a floating tag), then runs:

```sh
gitleaks git . \
  --config .gitleaks.toml \
  --no-banner --redact --verbose \
  --report-format sarif --report-path gitleaks-results.sarif \
  --exit-code 1
```

`gitleaks git` (not `gitleaks dir` or the removed `gitleaks detect`) scans full commit history, not just the working tree, on a full-history checkout (`fetch-depth: 0`). The SARIF report is uploaded to GitHub code scanning (`github/codeql-action/upload-sarif@v4`) with `continue-on-error: true`, since a private repo without GitHub Advanced Security can't ingest SARIF, but `--exit-code 1` on the scan step itself is the real, unconditional gate.

`.gitleaks.toml` extends the full upstream rule set (`extend.useDefault = true`) and carries a narrow, deliberately documented allowlist: the lockfile (sha512 integrity hashes trip the entropy heuristic), the generated TanStack route tree, the internal ESLint plugin's build output, and three exact-value exemptions for known-synthetic CI/test secrets (a throwaway `ENCRYPTION_KEY` used across `ci.yml` and `apps/api/test/setup-env.ts`, a historical dev-sample `ENCRYPTION_KEY` that only exists in git history now, and a synthetic `CSRF_SECRET` test string). Each exemption is by **exact value**, so a real secret sharing the same shape still fails the scan.

## Local CI via `act`

Full detail lives in `docs/local-ci.md`; summary here.

[`act`](https://nektosact.com) replays `ci.yml` inside Docker locally. `.actrc` pins no container architecture. On Apple Silicon, add `--container-architecture=linux/arm64` for native speed (GitHub's runners are amd64, so that isn't a literal arch match, but it catches everything arch-independent: lint, types, tests, migrations, knip, boot failures). A root `postinstall` script (`scripts/fix-trpc-native-perms.mjs`) restores the executable bit on the `nestjs-trpc generate` native binary, which is required specifically under arm64-Linux-in-`act` (the Linux build of that binary ships without `+x`; darwin and GitHub's real amd64 runner are unaffected).

```sh
pnpm ci:local        # the `quality` job, the everyday gate
pnpm ci:local:build   # `build` (pulls in `quality` via needs)
pnpm ci:local:audit   # `audit`
pnpm ci:local:web     # `test-web`
pnpm ci:local:api     # `test-api`
pnpm ci:local:e2e     # `test-e2e` (Playwright, and the built-API boot check)
pnpm ci:local:all     # every job, one `act -j` invocation per job, sequentially
pnpm ci:local:list    # act -l (list jobs, no run)
```

`ci:local:all` runs each job as its **own** separate `act -j` invocation rather than one combined run, because `act` holds a service job's Postgres bound to `host:5432` until the whole invocation ends, running the full workflow in one call would make the second and third service jobs fail with "port already allocated." `.actrc` also sets `--concurrent-jobs=1` as a backstop. Target a subset with `CI_LOCAL_JOBS="test-api test-e2e" pnpm ci:local:all`.

Service jobs (`test-api`, `test-e2e`) use GitHub `services:` reached at `localhost:5432`/`localhost:6379`, which only works under `act` because `.actrc` sets `--network=host`. Since the local dev stack already binds those same ports, the wrapper `scripts/ci-local.sh` stops any container publishing 5432/6379 before the run, lets `act` bind its own clean service containers, and restarts the dev stack afterward (including on Ctrl-C). Containers on other ports (mailpit, s3rver) are left alone so the e2e API boot can still reach them.

The wrapper takes a lock (`$TMPDIR/nest-vite-saas-starter-act-ci-local.lock`) so two `ci:local` runs can't fight over host ports and per-package build temp files simultaneously; a hard-killed run's stale lock is detected and reclaimed automatically. If the wrapper itself is SIGKILL'd, restart the dev containers by hand: `docker start saas-starter-postgres saas-starter-redis`.

Other notes: `actions/cache@v4` has no local backend under `act` (harmless warning, install just runs uncached); `actions/upload-artifact@v4` writes to the gitignored `.artifacts/`; add `--action-offline-mode` for faster repeat runs once images are cached; Lighthouse is skipped under `act` (see above); a true amd64 arch check is possible via `act -j <job> --container-architecture linux/amd64` but runs under slow emulation and currently trips a PATH issue in `actions/setup-node`, so it isn't the default, rely on GitHub for the real amd64 result.

Secrets: only `secrets.TURBO_TOKEN` / `vars.TURBO_TEAM` are read, both optional (turbo just skips remote caching without them). `.env.act` (tracked, minimal) replaces `act`'s default `.env` auto-load so real gitignored dev secrets in `./.env` never leak into the local runner.

## Husky hooks

`.husky/` contains three hooks, all wired through the `prepare` script (`husky`) in the root `package.json`:

| Hook         | Command                                                               | Purpose                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `pnpm --filter @repo/eslint-plugin-repo build` then `npx lint-staged` | Builds the internal ESLint plugin first (lint-staged bypasses turbo, so `^build` never fires there), then runs `lint-staged` (`.lintstagedrc.json`: `eslint --fix` + `prettier --write` on staged files) |
| `commit-msg` | `npx --no -- commitlint --edit $1`                                    | Enforces conventional-commit format (`commitlint.config.cjs`)                                                                                                                                            |
| `pre-push`   | `bash scripts/ci/pre-push.sh`                                         | The full local CI-parity gate, see below                                                                                                                                                                 |

### `pre-push.sh`: the CI-parity gate

This script mirrors `ci.yml` so "passes locally, fails in CI" is structurally hard to hit. Every command it runs (except gitleaks, which mirrors the separate `security-secrets.yml` workflow) is listed in `scripts/ci/pre-push.manifest.json`, and the `pre-push-ci-parity` lint-meta rule fails the build if any manifest command is missing from `ci.yml`: so the parity is enforced, not just aspirational.

What it runs, in order:

1. **Gitleaks secret scan** (hard gate). Prefers a native `gitleaks` binary; falls back to the pinned `ghcr.io/gitleaks/gitleaks:v8.30.1` Docker image if none is installed; set `PRE_PUSH_SKIP_GITLEAKS=1` to bypass locally (CI still enforces it independently via `security-secrets.yml`).
2. **Fast checks (no services)**: `pnpm build:packages`, `pnpm exec turbo lint`, `pnpm exec turbo check-types` (both run the **full** graph locally, unlike CI's `--affected` narrowing on PRs), `pnpm lint:meta`, `pnpm check:lint-meta-docs`, `pnpm --filter @repo/api knip`, `pnpm --filter @repo/web knip`.
3. **Coverage ratchets** (self-contained, no DB needed): `pnpm --filter @repo/api test:cov:check`, `pnpm --filter @repo/web test:cov:check`.
4. **Prisma gates** (need a reachable database): `db:migrate:check` and `db:migrate:status`, but only if something is listening on `localhost:5432`: if not, they're skipped with a clear message (start one with `docker compose up -d postgres`), or force-skip explicitly with `PRE_PUSH_SKIP_DB=1`.

Any failed step is collected and reported at the end; the script exits non-zero (aborting the push) if anything failed, or prints "pre-push checks passed" otherwise.

## Dependabot

`.github/dependabot.yml` configures three ecosystems, all weekly (Monday 06:00 UTC):

- **npm** (root directory, covers the whole workspace), grouped updates for `@nestjs/*`/`nestjs-*`, `prisma`/`@prisma/*`, `@tanstack/*`, `@trpc/*`, `eslint`-family, `@types/*`, and a catch-all `patch-and-minor` group that explicitly excludes `electron`, `electron-builder`, `react`, `react-dom` (these get individual PRs since major-adjacent bumps in them are higher-risk). Commit prefix `chore(deps)`.
- **github-actions**: commit prefix `chore(ci)`.
- **docker**: one entry each for `/apps/api` and `/apps/web` (their respective Dockerfiles). Commit prefix `chore(docker)`.

## CODEOWNERS and PR templates

`.github/PULL_REQUEST_TEMPLATE.md` exists; `.github/ISSUE_TEMPLATE/` has `bug.yml`, `feature.yml`, and `config.yml`. These are process scaffolding, not CI gates, check them directly if you need the current PR checklist copy. Add a `.github/CODEOWNERS` in your own fork if you want automatic reviewer routing.
