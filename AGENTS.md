# AGENTS.md

Contract for any coding agent (Claude Code, Codex, or anything else that reads `AGENTS.md`)
working in this repo, in the main checkout or in any git worktree. If this file and the lint
config disagree, the lint config wins.

Stack: pnpm + turbo monorepo. `apps/api` (NestJS 11 + nestjs-trpc + Prisma 7), `apps/web` (Vite
SPA, TanStack Router/Query), `packages/*` (shared, database, eslint-config, ui, ...). Node `>=26`,
pnpm `12.18.0`.

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

Before assuming a Docker stack is clear or data is lost, run `docker ps -a`. Plain `docker ps` hides
exited containers (`nest-vite-starter-postgres`). Never `pkill`/`killall` by pattern (every worktree path
contains "vite"); kill by explicit PID. A bare `docker compose up -d` from a worktree swaps the dev
database under you; the compose project name is pinned for that reason, do not work around it.

## The gate (what CI runs)

`.github/workflows/ci.yml` is the source of truth. `pnpm verify` runs its five lanes locally
(format, lint, typecheck, test, build; `pnpm verify --list` prints each lane's commands, and
`tools/README.md` explains them). The lint lane includes `pnpm lint:meta` (the required rules in
`tools/lint-meta/RULES.md`) and the test lane includes the tools tests. The `check` job, in order:

```bash
# check (no services)
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level=high
pnpm verify --lane=format
pnpm verify --lane=lint
pnpm verify --lane=typecheck
pnpm knip
pnpm verify --lane=test
pnpm verify --lane=build
pnpm size:check          # initial-load byte budget (scripts/check-initial-bundle.mjs)
pnpm check:contrast      # WCAG ratios of the design tokens (scripts/check-contrast.mjs)
```

The `integration` and `e2e` jobs need Postgres and Valkey (and Mailpit for e2e). Locally, start
this repo's compose stack (host ports 5442, 6389, 1035 and 8035; use your own `-p` name for a
second copy, and note the fixed `container_name` values mean only one copy can run at a time), EXPORT `DATABASE_URL` and `REDIS_URL` in the shell (`setup-env.ts` otherwise falls back to
the CI-shaped `test` database), then:

```bash
pnpm --filter @repo/database db:migrate:deploy
pnpm --filter @repo/database db:migrate:status   # history matches the migrations folder
pnpm --filter @repo/database db:migrate:check    # schema has no unmigrated change
pnpm --filter @repo/api test:integration         # *.isolation.spec.ts, real Postgres and Valkey
```

For e2e, seed with `db:seed` (near-empty, the shape CI uses, not `db:seed:dev`), build with
`pnpm exec turbo build --filter=@repo/api --filter=@repo/web`, start `node apps/api/dist/src/main.js`
with the production env from the e2e job's "Start API" step exported (the api refuses localhost, an
empty captcha and cleartext SMTP in production, see `apps/api/src/config/env.ts`), and `pnpm --filter @repo/web exec vite preview`, then run
`pnpm --filter @repo/web exec playwright test`. Set `PLAYWRIGHT_BASE_URL` when the web is not on
:5173. The `images` job builds both Dockerfiles and runs `scripts/image-smoke.sh` (`--build` builds them first), which boots each image as uid 10001 with a read-only root.

The husky hooks: pre-commit runs lint-staged, commit-msg runs commitlint, and pre-push runs
`pnpm verify --lane=typecheck`, then `pnpm verify --lane=test --affected=origin/main` (turbo tests
only for affected packages; every test when that ref does not resolve), and gitleaks over the pushed
range when gitleaks is installed.

## Commits

- Conventional commits: `type(scope): subject`. commitlint's `scope-enum` allows only:
  `api, web, ui, shared, database, email, eslint-config, tsconfig, config, deps, ci, docs, auth,
audit, observability` (`commitlint.config.cjs` is the source of truth).
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
  or empty `catch {}` in hand-written source. Add a scoped ESLint override, not an
  inline directive, when a rule is genuinely wrong for a path.
- **Verify against more than one data shape** when a behavior depends on volume or seed data.
- Generated files are never hand-edited or hand-merged: regenerate them (`apps/web/src/routeTree.gen.ts`,
  `apps/api/src/@generated/**`, the Prisma client via `db:generate`).

## Docs to load on demand

Read only the one that matches your task; do not load them all.

| When you are ...                                                 | Read                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| adding or changing an API module or router                       | `apps/api/src/modules/README.md`                                           |
| adding or changing a web feature or screen                       | `apps/web/src/features/README.md`                                          |
| reviewing a change to a guarded subsystem                        | `docs/invariants/` (load only the manifests whose `globs:` match the diff) |
| changing the Prisma schema or a migration                        | `docs/migration-playbook.md`                                               |
| changing merge bar, hooks or secret scanning                     | `CONTRIBUTING.md`, `.husky/`, `.github/workflows/`                         |
| adding or changing an `overrides` entry in `pnpm-workspace.yaml` | `docs/dependency-overrides.md`                                             |
| running a support procedure                                      | `docs/runbooks/`                                                           |
