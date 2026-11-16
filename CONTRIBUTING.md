# Contributing

This is a pnpm monorepo (Vite SPA + NestJS + Electron). One command set, one
merge bar. Local green is CI green.

## Setup

```sh
pnpm install
```

Node `>=22.22.3` and pnpm `10.33.2` (see the `packageManager` field). The
`prepare` script installs the husky hooks on install.

## The merge bar

Every change must pass the pre-push gate, which mirrors
`.github/workflows/ci.yml`. Push to run it, or invoke the checks directly:

| Check                   | Command                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Build internal packages | `pnpm build:packages`                                                                 |
| Lint                    | `pnpm exec turbo lint`                                                                |
| Types                   | `pnpm exec turbo check-types`                                                         |
| Meta lint (repo rules)  | `pnpm lint:meta`                                                                      |
| Meta docs drift         | `pnpm check:lint-meta-docs`                                                           |
| Dead code               | `pnpm --filter @repo/api knip` and `pnpm --filter @repo/web knip`                     |
| Coverage ratchet        | `pnpm --filter @repo/api test:cov:check` and `pnpm --filter @repo/web test:cov:check` |
| Secret scan             | gitleaks (see below)                                                                  |

The Prisma migration gates also run when a database is reachable on
`localhost:5432`. Set `PRE_PUSH_SKIP_DB=1` to skip them.

## Secret scanning

A pre-push gitleaks gate blocks commits that contain secrets. Install gitleaks
once per machine (`brew install gitleaks` on macOS, `scoop install gitleaks` on
Windows), or have Docker running for the bundled fallback. In an emergency, set
`PRE_PUSH_SKIP_GITLEAKS=1` to bypass it; CI still enforces the scan.

CI runs the same scan on every push and pull request
(`.github/workflows/security-secrets.yml`). On the public repository, also keep GitHub
secret scanning and push protection enabled: they block a known-format secret before it
lands, and gitleaks covers the rest.

## Commits

Conventional commits, enforced by commitlint on every commit message:

- Type from the conventional set: `feat`, `fix`, `docs`, `chore`, `ci`, `build`,
  `refactor`, `perf`, `test`, `revert`, `style`.
- Scope must come from this set: `api`, `web`, `desktop`, `ui`, `shared`,
  `database`, `email`, `config`, `deps`, `auth`, `audit`, `observability`,
  `docs` (`commitlint.config.cjs` is the source of truth).
- Example: `feat(auth): add session revocation`.

## Lint policy

Severity is error or off, never warn. If a rule fights real intent, change the
ESLint config and explain why, rather than adding an inline disable. Inline
`eslint-disable` and `@ts-ignore` are blocked in source by `lint:meta`. Repo
rule changes must keep `RULES.md` in sync (regenerate with
`pnpm generate:lint-meta-docs`); `lint:meta` fails on drift.
