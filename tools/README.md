# tools

Two small tools that hold the gate: `pnpm verify` runs it, `pnpm lint:meta` checks the things ESLint
and tests cannot see. CI calls the same lanes (`.github/workflows/ci.yml`, job `check`).

## `pnpm verify`

Runs the lanes in `verify/lanes.ts` in order, streams each command's output, and ends with one line
per lane. A failed lane does not stop the next one, so one run shows every red lane. Exit code 0
means every lane passed.

| Lane        | Runs                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| `format`    | `pnpm format:check` (Prettier)                                                   |
| `lint`      | `turbo lint`, `pnpm lint:tools`, `pnpm lint:meta`, `pnpm lint:meta:docs --check` |
| `typecheck` | `turbo check-types`, `pnpm check-types:tools`                                    |
| `test`      | `turbo test` (api jest, web and ui vitest), `pnpm test:tools`                    |
| `build`     | `turbo build`                                                                    |

```bash
pnpm verify                          # every lane
pnpm verify --lane=lint,typecheck    # some lanes (or repeat --lane)
pnpm verify --lane=test --affected   # turbo tasks only for packages changed since origin/main
pnpm verify --list                   # print the lanes and their commands
```

The pre-push hook runs `--lane=typecheck` and `--lane=test --affected=origin/main`. CI never uses
`--affected` (`ci-gate-intact` fails if it does).

To add a lane, or a command to one: add it to `LANES` in `verify/lanes.ts` (each command is an argv
of an existing package script or turbo task), update the lane test in `verify/lanes.test.ts`, and add
a `pnpm verify --lane=<id>` step to the `check` job in ci.yml. `ci-gate-intact` fails until CI runs
the new lane.

## `pnpm lint:meta`

`@noctcore/harness` runs the rules in `lint-meta/registry.ts`. Every rule is required: a violation
fails the build. `lint-meta/RULES.md` is generated from the registry (`pnpm lint:meta:docs`), and the
lint lane fails when it is stale.

| Rule                                         | Guards                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `procedures-require-guard`                   | Every tRPC procedure has `AuthMiddleware`, or is in `PUBLIC_PROCEDURES` with a reason.                                |
| `establish-session-callers`                  | Only allowlisted files call `establishSession`, so no sign-in skips the 2FA seam.                                     |
| `session-epoch-captured`                     | Every sign-in passes the session epoch read before the credential check.                                              |
| `session-landing-declared`                   | Every file that mints a session declares where the caller lands.                                                      |
| `required-rules-at-error`                    | The security ESLint rules resolve to `error` (shell, timing, redirect, path, fetch, mass assignment, audit, raw SQL). |
| `raw-sql-allowlist-pinned`                   | The raw SQL allowlist names only files pinned in `RAW_SQL_ALLOWLIST`.                                                 |
| `github-actions-sha-pinned`                  | Every action is pinned to a commit SHA.                                                                               |
| `github-actions-least-privilege-permissions` | Workflows declare read-only top-level permissions.                                                                    |
| `eslint-config-no-warn`                      | No ESLint rule resolves to `warn`.                                                                                    |
| `no-inline-lint-disable`                     | No inline `eslint-disable`; exceptions are scoped config overrides.                                                   |
| `no-ts-ignore`                               | No `@ts-ignore` or `@ts-expect-error`.                                                                                |
| `tsconfig-strict`                            | The shared base keeps the strict flags on and no tsconfig turns one off.                                              |
| `ci-gate-intact`                             | ci.yml runs on pull requests, runs every verify lane, and no step uses `continue-on-error`.                           |

Rules from `@noctcore/lint-meta-rules` are configured in the registry; the local ones live in
`lint-meta/rules/` with a test beside each.

To add a rule:

1. Prefer a published factory from `@noctcore/lint-meta-rules` and configure it in `registry.ts`.
2. Otherwise write `lint-meta/rules/<id>.ts` exporting an `IMetaRule` (types from
   `@noctcore/harness`) with `ciCritical: true`, plus `<id>.test.ts` that builds a fixture repo with
   `createFixture` from `lint-meta/test-support.ts` and shows the rule passing and failing.
3. Add it to `META_RULES` in `registry.ts`, run `pnpm lint:meta:docs`, and add a row above.

Keep the list short: a rule belongs here only when it guards auth, security or the gate itself.
