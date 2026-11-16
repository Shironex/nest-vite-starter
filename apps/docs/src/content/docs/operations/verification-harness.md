---
title: Verification Harness
description: pnpm verify and the tooling under it - the sandbox, the e2e lane, the security spec, the isolation canary and the test inventory - and how pre-push and CI compose them.
sidebar:
  order: 2
---

Everything here lives in `tools/` and runs from the repo root. If you only read one
thing: **`pnpm verify` is the entry point, and a check that could not run is never a
pass.**

This page is the map. Depth lives elsewhere and is linked per section.

## Why the harness exists

Three failures kept happening, and none of them were visible from a green terminal:

1. **A gate that did not run looked like a gate that passed.** Skipping the database
   gate because Docker was down printed a tick next to it.
2. **Parallel worktrees shared one database.** Two agents running the isolation lane at
   once produced failures that belonged to neither of them, and an e2e run could read
   the developer's own dev stack.
3. **Green did not mean covered.** The isolation lane passed while six of twelve
   tenant-scoped models had no cross-tenant test at all, and a deleted test case moved
   no coverage number far enough to notice.

Each tool below answers one of those.

## `pnpm verify`

```sh
pnpm verify --profile=static     # no services: lint, types, lint-meta, format, contrast
pnpm verify --profile=feature    # + unit suites, knip, coverage, isolation, Prisma gates, inventory
pnpm verify --profile=release    # + security spec, isolation canary, noctcore versions, size budget, e2e
pnpm verify --profile=feature --json
```

It runs the checks for the profile, writes one JSON evidence file to
`.agent-state/verification/<runId>.json`, and exits:

| Exit | Meaning                             |
| ---- | ----------------------------------- |
| `0`  | passed                              |
| `1`  | failed: a check ran and disagreed   |
| `2`  | **blocked**: the run proved nothing |

Blocked is the important one. A service was missing, a report did not parse or held a
skipped case, an exit code disagreed with its own totals, or the working tree changed
mid-run. The evidence file is fingerprinted against the tree, so a result cannot be
quoted for code it did not inspect.

The check list is `tools/verify/checks.ts`. A check carrying `manifestCommand` is tied to
the exact string in `scripts/ci/pre-push.manifest.json`, and a test asserts both
directions, so a gate cannot be added to one place and forgotten in the other.

:::caution
`--json` does not put the document alone on stdout: pnpm's banner and child process
output share the stream. Extract the JSON, do not pipe it straight into a parser.
:::

## `pnpm sandbox:up` - a private stack per worktree

```sh
pnpm sandbox:up        # idempotent; prints the services and ports
pnpm sandbox:inspect   # what is running (no credentials)
pnpm sandbox:inspect --lane-url=isolation   # that lane's DATABASE_URL
pnpm sandbox:down      # remove only THIS worktree's containers
```

Postgres, Redis, S3 and Mailpit on **random loopback ports**, labeled with a hash of the
worktree's real path. Images are read from `ci.yml`, so the sandbox and CI cannot drift.

Inside it are three named lanes, each with its own database, Redis index and bucket:

| Lane           | Database                    | Redis DB |
| -------------- | --------------------------- | -------- |
| `isolation`    | `saas_starter_isolation`    | 1        |
| `e2e`          | `saas_starter_e2e`          | 2        |
| `prisma_gates` | `saas_starter_prisma_gates` | 3        |

Lane databases are cloned from a template that is migrated once, so creating all three
takes well under a second rather than three migration runs.

**It never touches the `saas-starter-*` dev stack.** Never bind host port 5432 by hand, and
never run a bare `docker compose up` from a worktree: the compose project name is pinned
because that used to swap the dev database out from under you.

## `pnpm e2e:lane`

Runs Playwright against servers it owns: its own API and `vite preview` on free ports,
against the sandbox's `e2e` database, `retries: 0`, torn down by process group.

This is what makes e2e runnable from a worktree at all. It also caught a real bug the
moment it existed: two mail specs had `localhost:8025` hardcoded, so they read the
developer's dev Mailpit while the API delivered to the sandbox's. They only ever passed
because everything shared one stack.

CI runs the suite directly rather than through this lane, so the CI step asks for the
JUnit reporter on the command line.

## `pnpm check:security` - the executable security spec

`apps/api/security-spec/` holds one file per security finding, and
`security-spec/findings.json` is the register. The check reconciles them **both ways**: a
finding with no spec fails, and a spec with no finding fails. Write a new one with
`pnpm new:finding`.

It runs in CI inside `test-api` **without** the api path filter, on purpose: a change that
breaks a security fix very often does not look like an api change.

## `pnpm canary:isolation` - proving the isolation lane bites

Mutation testing for the tenant boundary. It removes each tenant-scoped model from the
boundary in turn and requires the isolation lane to go red. One mutant per scoped model,
about a minute, `release` profile only.

This is the single most valuable thing in the harness, because of what it found on its
first run: **half of the tenant-scoped models** could be dropped from the tenant boundary
with the whole lane still green. The lane only looked thorough.

All of them are covered now, and the `isolation-canary-coverage` lint-meta rule fails when a
scoped model has no mutant, so the gap cannot reopen quietly.

## `pnpm check:noctcore-published` - reaching the published noctcore

Compares every declared `@noctcore/*` range, and the version installed for it, against the
registry's latest. It is the other half of lint:meta's `noctcore-packages-current`, which
compares declared against installed and stays offline: those two can agree perfectly while
both sit a minor behind what is published, because a caret on `0.x` never crosses the minor.

It reports two cases apart, because they need different fixes:

- **Range cannot reach the published version.** `^0.5.0` with 0.6.0 published. No install
  fixes it; the message names the `pnpm add` that widens the range.
- **Lockfile is stale.** `^0.3.0` with 0.3.1 published and 0.3.0 installed. The message
  names the `pnpm update -r` that moves it.

`release` profile only, never lint:meta or pre-push, so nothing on the per-push path needs
the registry. An unreachable registry exits 2, which `verify` reports as BLOCKED.

## `pnpm verify:inventory` - the committed test inventory

The only thing in the repo that notices when a test case stops existing. Full detail,
including the merge rule, is in [Testing Strategy](/operations/testing-strategy/).

## How it composes

```
edit  ->  pnpm verify --profile=static        seconds, no services
       ->  pnpm verify --profile=feature       the usual pre-merge answer
push  ->  .husky/pre-push -> scripts/ci/pre-push.sh
CI    ->  .github/workflows/ci.yml             five jobs
```

**Pre-push** runs the manifest gates and exits `2 INCOMPLETE` when it had to skip one, so a
skipped gate cannot be mistaken for a passed one. `PRE_PUSH_ALLOW_INCOMPLETE=1` overrides
it deliberately. Its database probe performs a real Postgres startup handshake rather than
opening a TCP socket, because a published Docker port accepts a connection well before the
server is ready, and it accepts any server at all.

**CI** decides what to run with `scripts/ci/affected.sh <task> <filters...>`, which fails
safe: a turbo error, unparseable output or a missing task list all mean _run the job_. The
e2e probe deliberately names both `@repo/web` and `@repo/api`, because web has no package
dependency on the api, so an api-only change would otherwise skip e2e, and e2e is now where
the API boot is proven.

See [CI/CD](/operations/ci-cd/) for the job breakdown and
[Build & DX](/architecture/build-and-dx/) for lint-meta and the codegen tools.
