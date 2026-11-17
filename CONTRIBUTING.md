# Contributing

This is a pnpm monorepo (Vite SPA + NestJS). One command set, one
merge bar. Local green is CI green.

## Setup

```sh
pnpm install
```

Node `>=26` and pnpm `10.34.9` (see the `packageManager` field). The
`prepare` script installs the husky hooks on install.

## The merge bar

Every change must pass `.github/workflows/ci.yml`. Run `pnpm verify` before you push: it runs the
same five lanes as the `check` job (format, lint, typecheck, test, build, including the lint-meta
rules and the tools tests). The `check` job runs, in order:

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
runs the api integration specs against Postgres and Redis. The `e2e` job runs the Playwright suite
against the built api and web. The `images` job builds both Dockerfiles. `AGENTS.md` lists the
commands to run each job locally.

The husky pre-push hook runs the fast subset: the typecheck lane, the test lane for packages
affected since `origin/main`, and gitleaks over the pushed commits.

## Secret scanning

Install gitleaks once per machine (`brew install gitleaks` on macOS, `scoop install gitleaks` on
Windows) and the pre-push hook scans every push. Without it the hook skips the scan and says so.

CI runs the same scan over the full history on every push and pull request
(`.github/workflows/secrets.yml`). On the public repository, also keep GitHub
secret scanning and push protection enabled: they block a known-format secret before it
lands, and gitleaks covers the rest.

## Commits

Conventional commits, enforced by commitlint on every commit message:

- Type from the conventional set: `feat`, `fix`, `docs`, `chore`, `ci`, `build`,
  `refactor`, `perf`, `test`, `revert`, `style`.
- Scope must come from this set: `api`, `web`, `ui`, `shared`, `database`,
  `email`, `eslint-config`, `tsconfig`, `config`, `deps`, `ci`, `docs`, `auth`,
  `audit`, `observability` (`commitlint.config.cjs` is the source of truth).
- Example: `feat(auth): add session revocation`.

## Lint policy

Severity is error or off, never warn. If a rule fights real intent, change the
ESLint config and explain why, rather than adding an inline disable.
