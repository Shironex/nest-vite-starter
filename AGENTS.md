# AGENTS.md

Contract for any coding agent (or person) working in this repo, in the main checkout or in a git
worktree. If this file and the lint config disagree, the lint config wins.

## What this is

pnpm + Turborepo monorepo, Node 26, pnpm 12.18.0. `apps/api` (NestJS 11, nestjs-trpc, Prisma 7),
`apps/web` (Vite SPA, TanStack Router and Query), `packages/` (database, shared, ui, email,
eslint-config, tsconfig), `tools/` (`pnpm verify`, `pnpm lint:meta`). The README has the layout and
the "add a module" walkthrough; `docs/architecture.md` and `docs/auth.md` explain the moving parts.

## Bootstrap (do all four first)

A fresh checkout or worktree lacks every gitignored file. Skipping a step fails for reasons
unrelated to your task.

1. `nvm use` (Node 26), then `pnpm install`
2. `cp .env.example .env` at the repo root, and set `ENCRYPTION_KEY` (`openssl rand -base64 32`).
   `db:generate` dies on a missing `DATABASE_URL` even though it never connects.
3. `pnpm --filter @repo/database db:generate`. Without it `check-types` cannot find
   `../generated/prisma/client.js`.
4. Run builds, tests and typechecks **through turbo**, never a bare `pnpm --filter <pkg> test`:
   `pnpm exec turbo test --filter=@repo/web`. A bare run finds no `@repo/shared` `dist` and skips
   generating `apps/api/src/@generated/server.ts`.

## Dev services and ports

`docker compose up -d` starts Postgres (127.0.0.1:5442), Valkey (6389), Mailpit (SMTP 1035, UI
8035). `pnpm dev` runs the api on :3000 and the web on :5173. The compose project name and
container names are pinned, so one copy of the stack runs per machine; do not work around it with
another `-p`. `docker ps -a` shows exited containers, plain `docker ps` hides them: check before
assuming a stack is clear or data is lost. Never `pkill` by pattern (every worktree path contains
"vite"); stop processes by explicit PID.

## Commands

```bash
pnpm dev                          # api + web
pnpm verify                       # the gate: format, lint, typecheck, test, build lanes
pnpm verify --list                # the commands behind each lane (tools/README.md)
pnpm lint:meta                    # required auth, security and gate rules (tools/lint-meta/RULES.md)
pnpm exec turbo test --filter=@repo/api
pnpm --filter @repo/database db:migrate -- --name <name>   # new migration (docs/migration-playbook.md)
pnpm --filter @repo/api user:promote <email>               # make an account an admin
```

## The gate

`.github/workflows/ci.yml` is the source of truth. The `check` job runs, in order:

```bash
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level=high
pnpm verify --lane=format
pnpm verify --lane=lint
pnpm verify --lane=typecheck
pnpm knip
pnpm verify --lane=test
pnpm verify --lane=build
pnpm size:check                   # initial-load byte budget
pnpm check:contrast               # WCAG ratios of the design tokens
```

The `integration` and `e2e` jobs need Postgres and Valkey (and Mailpit for e2e). Start the compose
stack, export `DATABASE_URL` and `REDIS_URL` in the shell (`setup-env.ts` otherwise falls back to
the CI-shaped `test` database), then:

```bash
pnpm --filter @repo/database db:migrate:deploy
pnpm --filter @repo/database db:migrate:status   # history matches the migrations folder
pnpm --filter @repo/database db:migrate:check    # schema has no unmigrated change
pnpm --filter @repo/api test:integration         # *.isolation.spec.ts, real Postgres and Valkey
```

For e2e: `db:seed` (near-empty, the shape CI uses), `pnpm exec turbo build --filter=@repo/api
--filter=@repo/web`, start `node apps/api/dist/src/main.js` with the production env from the e2e
job's "Start API" step (the api refuses localhost, an empty captcha and cleartext SMTP in
production), start `pnpm --filter @repo/web exec vite preview --port 5173 --strictPort`, then
`pnpm --filter @repo/web exec playwright test` (`PLAYWRIGHT_BASE_URL` when the web is not on
:5173). The `images` job runs `scripts/image-smoke.sh --build`.

Husky: pre-commit runs lint-staged, commit-msg runs commitlint, pre-push runs the typecheck lane,
the tests of affected packages, and gitleaks when installed.

## Commits and PRs

- Conventional commits, `type(scope): subject`, one logical change each. commitlint's `scope-enum`
  (`commitlint.config.cjs`) is the source of truth for scopes: `api, web, ui, shared, database,
email, eslint-config, tsconfig, config, deps, ci, docker, docs, auth, audit, observability`.
- `Closes #N` in the footer of the commit that completes an issue, `Refs #N` for partial work.
- No em or en dashes in code, comments, docs or commit messages: use commas, colons or parentheses.
- Do not push, merge or rebase unless the task asks for it.

## Conventions

- **A test is not coverage until it has failed.** Watch it fail against the broken behavior first.
- **Never describe a change you have not read back.** Re-read the file or the diff first.
- **Scripts orchestrate; `src/` decides.** Logic lives in tested source, not in scripts.
- **Reproduce on the base before blaming your change.** A failing test on a fresh checkout is
  first checked against the unmodified base commit.
- **Never suppress, fix.** No `as any`, `@ts-ignore`, `@ts-expect-error`, inline `eslint-disable`
  or empty `catch {}` in hand-written source. Add a scoped ESLint override when a rule is wrong
  for a path.
- Routers stay thin and every sign-in goes through the one session seam (`docs/auth.md`).
- Generated files are never hand-edited: regenerate `apps/web/src/routeTree.gen.ts`,
  `apps/api/src/@generated/**` and the Prisma client (`db:generate`).
- Native `fetch` for HTTP, no axios.

## Docs to load on demand

Read only the one that matches your task.

| When you are ...                                                 | Read                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| adding or changing an API module or router                       | `apps/api/src/modules/README.md`                                                       |
| adding or changing a web feature or screen                       | `apps/web/src/features/README.md`                                                      |
| touching auth, sessions or 2FA                                   | `docs/auth.md`, then `docs/invariants/` (only manifests whose `globs:` match the diff) |
| changing the Prisma schema or a migration                        | `docs/migration-playbook.md`                                                           |
| adding a queue or a job                                          | `apps/api/src/common/queue/CONVENTIONS.md`                                             |
| changing merge bar, hooks or secret scanning                     | `CONTRIBUTING.md`, `.husky/`, `.github/workflows/`                                     |
| adding or changing an `overrides` entry in `pnpm-workspace.yaml` | `docs/dependency-overrides.md`                                                         |
| deploying                                                        | `docs/deploy-coolify.md`, `docker-compose.prod.yml`                                    |
| adding S3, websockets, OAuth, i18n, metrics, otel and similar    | `docs/recipes/`                                                                        |
| running a support procedure                                      | `docs/runbooks/`                                                                       |
