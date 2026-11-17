# Contributing

Thanks for taking a look. This is a pnpm monorepo (Vite SPA and NestJS API) with one command set
and one merge bar: local green is CI green.

## Setup

You need Node 26 (`nvm use` reads `.nvmrc`), pnpm 12 (`npm install --global pnpm@12.18.0`) and
Docker. Then follow the README quick start: `pnpm install`, `cp .env.example .env`, set
`ENCRYPTION_KEY`, `docker compose up -d`, generate the Prisma client, migrate, seed and `pnpm dev`.
The `prepare` script installs the Husky hooks on install.

For a fresh git worktree, [AGENTS.md](AGENTS.md) lists the four bootstrap steps and why each one
matters.

## Commits

Conventional commits, enforced by commitlint on every commit message: `type(scope): lowercase
summary`.

- Type: `feat`, `fix`, `docs`, `chore`, `ci`, `build`, `refactor`, `perf`, `test`, `revert`,
  `style`.
- Scope is required and comes from this list: `api`, `web`, `ui`, `shared`, `database`, `email`,
  `eslint-config`, `tsconfig`, `config`, `deps`, `ci`, `docker`, `docs`, `auth`, `audit`,
  `observability` (`commitlint.config.cjs` is the source of truth).
- One logical change per commit. Example: `feat(auth): add session revocation`.
- Reference issues in the footer: `Closes #N` when the commit completes one, `Refs #N` otherwise.
- No em or en dashes in code, comments, docs or commit messages.

## The gate

Every change must pass `.github/workflows/ci.yml`. Run `pnpm verify` before you push: it runs the
same five lanes as the `check` job (format, lint including the lint-meta rules, typecheck, test,
build). The full `check` job, in order:

```bash
pnpm audit --prod --audit-level=high
pnpm verify --lane=format
pnpm verify --lane=lint
pnpm verify --lane=typecheck
pnpm knip
pnpm verify --lane=test
pnpm verify --lane=build
pnpm size:check
pnpm check:contrast
```

The `integration` job applies the migrations, checks the migration history and schema drift, and
runs the api integration specs against Postgres and Valkey. The `e2e` job runs the Playwright suite
against the built api and web. The `images` job builds both Dockerfiles and boots them with
`scripts/image-smoke.sh`. AGENTS.md lists the commands to run each job locally.

The pre-push hook runs the fast subset: the typecheck lane, the tests of packages affected since
`origin/main`, and gitleaks over the pushed commits.

## Pull requests

1. Fork the repository, or branch if you have access, and create a branch (`feat/...`, `fix/...`,
   `docs/...`).
2. Keep the pull request to one slice that leaves the tree green. Describe what changed and why,
   and how you tested it. Add a screenshot for UI changes.
3. A change that touches the Prisma schema includes the migration (`db:migrate -- --name <name>`),
   and one that adds an env key updates `.env.example` and the env schema together.
4. New behavior comes with tests, and a test counts once you have watched it fail without the fix.
5. CI must be green. A maintainer reviews and merges.

Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## Lint policy

Severity is error or off, never warn. If a rule fights real intent, change the ESLint config in
`packages/eslint-config` and explain why, rather than adding an inline disable or a `@ts-ignore`.

## Secret scanning

Install gitleaks once per machine (`brew install gitleaks` on macOS, `scoop install gitleaks` on
Windows) and the pre-push hook scans every push. Without it the hook skips the scan and says so.
CI runs the same scan over the full history on every push and pull request
(`.github/workflows/secrets.yml`). Test fixtures must not look like real secrets: build
token-shaped values at runtime from parts.
