# AGENTS.md

Contract for any coding agent (Claude Code, Codex, or anything else that reads `AGENTS.md`)
working in this repo, in the main checkout or in any git worktree. If this file and the lint
config disagree, the lint config wins.

Stack: pnpm + turbo monorepo. `apps/api` (NestJS 11 + nestjs-trpc + Prisma 7), `apps/web` (Vite
SPA, TanStack Router/Query), `packages/*` (shared, database, eslint-config, eslint-plugin-repo, ui, ...). Node `>=22.22.3`,
pnpm `10.34.9`.

## Bootstrap a fresh worktree (do all four first)

A worktree has none of the gitignored files a checkout accumulates. Skipping any step fails for
reasons unrelated to your task.

1. `pnpm install`
2. `cp .env.example .env` at the worktree ROOT. `.env` is gitignored, and `db:generate` dies on a
   missing `DATABASE_URL` even though it never connects.
3. `pnpm --filter @repo/database db:generate`. Without it `check-types` cannot find
   `../generated/prisma/client.js`.
4. Run builds, tests and type checks **through turbo**, never a bare `pnpm --filter <pkg> test`:
   `pnpm exec turbo test --filter=@repo/web`. A bare run finds no `@repo/shared` `dist` and skips
   generating `apps/api/src/@generated/server.ts`.

Run `pnpm build:packages` once as well if you want ESLint to work outside turbo (the Claude Code
edit hook and a bare `eslint` need the internal plugin's `dist`; turbo builds it for you).

Before assuming a Docker stack is clear or data is lost, run `docker ps -a`. Plain `docker ps` hides
exited containers (`saas-starter-postgres`). Never `pkill`/`killall` by pattern (every worktree path
contains "vite"); kill by explicit PID. A bare `docker compose up -d` from a worktree swaps the dev
database under you; the compose project name is pinned for that reason, do not work around it.

## The gate (what CI and the pre-push hook run)

`pnpm verify` is the single entry point. It runs the checks below, writes one JSON evidence file to
`.agent-state/verification/<runId>.json` and exits **0 passed, 1 failed, 2 blocked**. Blocked means
the run proved nothing: a service was not there, a report did not parse or held a skipped case, an
exit code disagreed with its own totals, or the working tree changed while the run was in flight.
A skipped check is never a pass.

```bash
pnpm verify --profile=static     # lint, both type checks, lint:meta, format, contrast. No services.
pnpm verify --profile=feature    # + unit suites, knip, coverage ratchets, isolation, Prisma gates
pnpm verify --profile=release    # + bundle budget and the e2e lane. Finish a change against this one.
pnpm verify --profile=release --json > evidence.json
```

The profiles nest, and `tools/verify/checks.ts` is the list. `release` is a superset of
`scripts/ci/pre-push.manifest.json`, asserted in both directions by `tools/verify/checks.test.ts`.

The last check is the **committed test inventory**: `tools/verify/inventories/<suite>.json` lists
every test case each suite runs, and `pnpm verify:inventory` compares a run against it. A deleted
case, an unexpected one, a duplicated title or a skipped case blocks the lane even when the suite
exits 0. `--accept` writes additions, removals need `--allow-removals` on top, and
`pnpm verify:inventory --merge-audit` run on a merged tree reports inventory changes neither parent
explains (that is merge damage).

`scripts/ci/pre-push.sh` mirrors `.github/workflows/ci.yml`; `scripts/ci/pre-push.manifest.json`
lists the commands, and the lint-meta rule `pre-push-ci-parity` fails if they drift from ci.yml.

```bash
pnpm build:packages
pnpm exec turbo lint
pnpm exec turbo check-types
pnpm check-types:tools                      # tools/ is not a workspace, so turbo never sees it
pnpm lint:meta                              # repo-specific rules (tools/lint-meta)
pnpm lint:tools
pnpm test:lint-meta                         # every test under tools/ plus the hook unit tests
pnpm check:lint-meta-docs                   # tools/lint-meta/RULES.md must be regenerated, not hand-edited
pnpm --filter @repo/api knip
pnpm --filter @repo/web knip
pnpm --filter @repo/api test:cov:check      # coverage ratchet (api and web)
pnpm --filter @repo/web test:cov:check
pnpm --filter @repo/database db:migrate:check    # the Prisma gates, against the sandbox lane
pnpm --filter @repo/database db:migrate:status
```

The hook exits **2 INCOMPLETE** when a gate did not run at all (no database reachable,
`PRE_PUSH_SKIP_DB=1`, `PRE_PUSH_SKIP_GITLEAKS=1`), which aborts the push the same way a failure
does. `PRE_PUSH_ALLOW_INCOMPLETE=1` pushes anyway and says so. Exit 1 still means a gate ran and
failed. CI also runs `pnpm --filter @repo/eslint-plugin-repo test` and `pnpm audit`, which the hook
does not; `verify feature` covers the former.

Turbo `lint` and `check-types` alone are NOT the gate. Format with
`pnpm exec prettier --check <files>` (prettier-tailwind config; `pnpm format` writes).

`docs/local-ci.md` covers running CI itself locally through `act` (`pnpm ci:local*`).

### The verification sandbox (one per worktree)

Every worktree can have its own Postgres, Redis and mailpit, so two of them verify at the
same time without sharing a database or a port. Plain `docker run`, bound to a random loopback port,
labeled with `sha256(realpath(worktree))`, and described by a 0600 file in the gitignored
`.agent-state/sandboxes/`. The images come from `ci.yml`, so local and CI run the same bytes.

```bash
pnpm sandbox:up        # start (or reset the lane databases of) this worktree's sandbox
pnpm sandbox:inspect   # ports and lanes, no credentials
pnpm sandbox:inspect --lane-url=isolation   # a lane's DATABASE_URL, for an exported env var
pnpm sandbox:down      # remove ONLY this worktree's labeled containers; safe to run twice
```

Three lanes, each with its own database, Redis index and bucket: `isolation`, `e2e` and
`prisma_gates`. `sandbox:up` migrates once into `saas_starter_template` and creates each lane with
`CREATE DATABASE ... TEMPLATE`, which is under a second per lane, so a lane is recreated fresh on
every run instead of drifting. Nothing here binds 5432, 6379, 1025 or 8025, and `sandbox:down`
selects containers by label and never prunes, so the dev compose project is untouched.

### Integration lane and e2e (need Postgres)

The fast unit lane never touches a database. Two lanes do, and `pnpm verify` runs both against the
sandbox. To run them by hand:

- **Integration** (`*.isolation.spec.ts`, the specs a mocked Prisma cannot prove: advisory locks,
  lockout under a real burst, flows across real rows):
  ```bash
  pnpm sandbox:up
  export DATABASE_URL="$(pnpm sandbox:inspect --lane-url=isolation | tail -n 1)"
  pnpm --filter @repo/api test:integration
  ```
  `DATABASE_URL` must be EXPORTED, or `setup-env.ts` falls back to the CI-shaped `test` database and
  every spec dies on "Authentication failed".
- **Security** (`apps/api/security-spec/*.security-spec.ts`, one file per audit finding, each case
  reconciled by name against `security-spec/findings.json`): export a real `DATABASE_URL`, then run
  `pnpm check:security` from the repo root. That command, not jest's exit code, is the gate: a
  finding recorded as `proven` carries an expected-red case. `pnpm new:finding <id> <slug> <issue>`
  scaffolds one, red until it is written. See `apps/api/security-spec/README.md`.
- **E2e** (Playwright, `apps/web/e2e`): `pnpm e2e:lane` owns the whole stack. It recreates
  `saas_starter_e2e` from the template, seeds it with `db:seed` (fresh and near-empty, the shape CI uses,
  NOT `db:seed:dev`), builds the api and the web app, starts both on free ports, waits on
  an HTTP probe, runs Playwright with `--retries=0` and tears the children down by process group
  even on failure. It never falls back to an ambient server: no sandbox, no run. Pass Playwright
  arguments after `--`:
  ```bash
  pnpm sandbox:up && pnpm e2e:lane -- two-factor.spec.ts
  ```
  `playwright.config.ts` has no `webServer` on purpose. A data-volume-sensitive test must pass on
  both shapes, so check a suspicious failure against `db:seed:dev` too.

Do not bind host port 5432 yourself, and do not touch another checkout's containers or volumes.

## Commits

- Conventional commits: `type(scope): subject`. commitlint's `scope-enum` allows only:
  `api, web, ui, shared, database, email, config, deps, auth, audit, observability, docs`
  (`commitlint.config.cjs` is the source of truth; there is no `ci`, `lint` or `repo` scope).
- `Closes #N` in the footer of the commit that completes an issue, `Refs #N` for partial work.
- No em dashes (U+2014) in code, comments, docs or commit messages. Use colons, commas or parens.
- Do not push, merge or rebase unless the task asks for it.

## House rules

- **A test is not coverage until it has failed.** Watch it fail against the broken behavior (or the
  removed fix) before trusting it green.
- **Never describe a change you have not read back.** Re-read the file (or the diff) before saying
  what a commit or edit does.
- **Scripts orchestrate; `src/` decides.** Scripts and tools shell out and wire; logic lives in
  tested source.
- **Reproduce on the base before blaming your change.** A failing test on a fresh worktree is
  first checked against the unmodified base commit.
- **Never suppress, fix.** No `as any`, `@ts-ignore`, `@ts-expect-error`, inline `eslint-disable`
  or empty `catch {}` in hand-written source; the lint config and `pnpm lint:meta` reject them and,
  in Claude Code, `scripts/hooks/` reports them at edit time. Add a scoped ESLint override, not an
  inline directive, when a rule is genuinely wrong for a path.
- **Verify against more than one data shape** when a behavior depends on volume or seed data.
- Generated files are never hand-edited or hand-merged: regenerate them (`apps/web/src/routeTree.gen.ts`,
  `apps/api/src/@generated/**`, the Prisma client via `db:generate`, `tools/lint-meta/RULES.md`).

## Docs to load on demand

Read only the one that matches your task; do not load them all.

| When you are ...                             | Read                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| adding or changing an API module or router   | `apps/api/src/modules/README.md`                                           |
| adding or changing a web feature or screen   | `apps/web/src/features/README.md`                                          |
| hitting a lint-meta failure or adding a rule | `tools/lint-meta/RULES.md` (generated: `pnpm generate:lint-meta-docs`)     |
| reviewing a change to a guarded subsystem    | `docs/invariants/` (load only the manifests whose `globs:` match the diff) |
| changing the Prisma schema or a migration    | `docs/migration-playbook.md`                                               |
| reproducing CI locally                       | `docs/local-ci.md`                                                         |
| changing merge bar, hooks or secret scanning | `CONTRIBUTING.md`, `scripts/ci/pre-push.sh`                                |
| adding or changing a `pnpm.overrides` entry  | `overrides.ledger.json` (the `pnpm-override-ledger` rule)                  |
| running a support procedure                  | `docs/runbooks/`                                                           |
