# Running CI locally with `act`

[`act`](https://nektosact.com) runs the GitHub Actions workflow in
`.github/workflows/ci.yml` inside Docker on your machine, so you can reproduce a
CI job without pushing and waiting on GitHub.

GitHub remains the true-parity gate. This local setup is the pre-push defense
step: a fast way to catch a break (lint, types, tests, migrations, boot) before
it reaches remote. It ships an `.actrc` and a wrapper script so every job,
including the service-bound ones, runs locally.

## Prerequisites

- Docker running (Docker Desktop, OrbStack, or colima). Check with `docker info`.
- `act` installed: `brew install act` (macOS) or see the
  [install guide](https://nektosact.com/installation/index.html).

The first run pulls the runner image `catthehacker/ubuntu:act-latest` (about 1 GB)
plus the postgres/redis service images, and does a full `pnpm install` in the
container. Expect a few minutes. Later runs reuse the images.

## Architecture

The repo's `.actrc` does not pin a container architecture, so `act` uses its
default, which matches GitHub's amd64 runners on an x86 machine.

On Apple Silicon, amd64 containers run under emulation and are slow. For native
speed, add `--container-architecture=linux/arm64` on the command line or in your
personal `~/.actrc`. That is not a literal arch match with GitHub, but it catches
everything arch-independent (lint, type, test, migration, knip, boot failures),
which is the whole job of a pre-push guard; the amd64 result still comes from CI.

One repo-specific workaround makes arm64 work: `nestjs-trpc generate` (a turbo
dependency of lint/check-types/build) runs a per-arch native binary, and the
Linux builds of that binary are published without the executable bit. A root
`postinstall` (`scripts/fix-trpc-native-perms.mjs`) restores `+x` after every
install. It is an idempotent no-op everywhere except arm64-Linux-under-act (the
darwin binaries already ship executable, and the amd64 binary does too).

This is a different problem from building the production Docker images
(`apps/api/Dockerfile`, `apps/web/Dockerfile`) on a Mac: `act`'s runner image
(`catthehacker/ubuntu:act-latest`) is glibc-based, so once the binary is
executable it runs fine. The production images used to build `FROM
node:22-alpine`, which is musl-based and cannot run the glibc-linked
`nestjs-trpc` native binary at all (`ENOENT` on the loader, on every
architecture, not just arm64). See [Apple Silicon
builds](/operations/operations-and-deployment/#apple-silicon-builds) for that
fix.

For a fast plain lint/type check without Docker at all, run the native turbo
tasks directly: `pnpm lint`, `pnpm check-types`. `act` is specifically for
reproducing the CI job end to end.

On Apple Silicon, an amd64 run under emulation is much slower and can trip an
act PATH issue at `actions/setup-node`; rely on CI for the real amd64 result.

## Commands

| Script                | Job(s)                                                              | Services freed first |
| --------------------- | ------------------------------------------------------------------- | -------------------- |
| `pnpm ci:local`       | `quality` (lint, check-types, lint:meta, knip, audit, plugin tests) | no                   |
| `pnpm ci:local:build` | `build` (runs `quality` via `needs`)                                | no                   |
| `pnpm ci:local:web`   | `test-web` (vitest, size budget, lighthouse)                        | no                   |
| `pnpm ci:local:api`   | `test-api` (jest + prisma migrate gates)                            | yes                  |
| `pnpm ci:local:e2e`   | `test-e2e` (Playwright, and the built-API boot check)               | yes                  |
| `pnpm ci:local:all`   | every job in the workflow                                           | yes                  |
| `pnpm ci:local:list`  | none (`act -l`)                                                     | no                   |

`pnpm ci:local` is the everyday gate (the same lint/type gate that blocks a PR).

`pnpm ci:local:all` is the thorough, slow pre-push run: it executes each job as
its own separate `act -j` invocation, sequentially (see "How the service jobs
work" for why). Because several jobs declare `needs: quality`, the `quality` job
re-runs as their prerequisite and there is no act flag to skip it, so the full
run takes a while. Run a custom subset with `CI_LOCAL_JOBS`:

```sh
CI_LOCAL_JOBS="test-api test-e2e" pnpm ci:local:all
```

You can also target any job directly, e.g. `act -j quality`, or dry-run the graph
with `act -j quality -n`.

## How the service jobs work locally

`test-api` and `test-e2e` use GitHub `services:` (postgres + redis) and reach
them at `localhost:5432` / `localhost:6379`. That works on GitHub
because the job runs on the runner VM. Under `act` the job runs inside a
container, so `localhost` only reaches those service ports when the job is on the
host network. `.actrc` sets `--network=host` for that.

The catch: your local dev stack already publishes 5432 and 6379, so `act` cannot
bind its own clean service containers there. The wrapper `scripts/ci-local.sh`
handles this, but only for runs that include a service job (the whole workflow,
or `-j test-api|test-e2e`):

1. Finds running containers publishing 5432 or 6379 and `docker stop`s them.
2. Runs `act` (which starts its own CI-identical postgres/redis).
3. Restarts the containers it stopped (on exit, including Ctrl-C; retried, since
   act may still be releasing the ports as it tears its own services down).

Service-free runs (`ci:local`, `ci:local:build`, `ci:local:web`) go through the same wrapper but leave your dev stack untouched.
Containers on other ports (e.g. mailpit on 1025) are always left
running, so the e2e API boot can still reach them. After the run the wrapper
restores your dev stack with `docker compose up -d`, which reliably re-binds the
host ports.

### Why ci:local:all runs each job separately

act keeps a service job's postgres bound to host:5432 until the whole `act`
invocation ends. So running the full workflow in one `act` call makes the second
and third service jobs fail with "port already allocated" (and the e2e specs then
fail with connection-refused). To avoid that, `ci:local:all` runs **one `act -j`
invocation per job** in sequence: each invocation fully tears down its own
postgres before the next one starts. `.actrc` also sets `--concurrent-jobs=1` as
a backstop for anyone running bare `act`.

### One run at a time

The wrapper takes a lock (`$TMPDIR/nest-vite-starter-act-ci-local.lock`) so a second
`ci:local` run is refused while one is active. Two `act` runs in parallel fight
over the host ports and over per-package build temp files (tsup writes a
transient `tsup.config.bundled_*.mjs` that the other run's `eslint .` then fails
to read), which surfaces as spurious failures. If a run is hard-killed the lock
goes stale; the next run detects the dead PID and reclaims it automatically.

If the wrapper is hard-killed (SIGKILL), the dev containers may be left stopped.
Restart them by hand:

```sh
docker start nest-vite-starter-postgres nest-vite-starter-redis
```

## Secrets and variables

The workflow only reads `secrets.TURBO_TOKEN` and `vars.TURBO_TEAM`, both optional
locally (turbo just skips the remote cache). To use them, copy `.secrets.example`
to `.secrets` and fill in `TURBO_TOKEN`, and put `TURBO_TEAM=...` in a `.vars`
file. Both are gitignored and auto-loaded by `act`.

`.env.act` (tracked, intentionally minimal) replaces act's default `.env`
auto-load so your real, gitignored `./.env` dev secrets never leak into the runner.

## Notes and gotchas

- The `test-web` job's Lighthouse step is skipped under act (`if: !env.ACT` in
  ci.yml): `lhci` needs a real Chrome install the act image lacks, and its perf
  scores are runner-dependent. It still runs on GitHub. `test-web` otherwise runs
  vitest and the bundle-size budget locally.
- `actions/cache@v4` has no local backend under `act`; you will see a
  skip/warning. It is harmless (the install just runs uncached).
- `actions/upload-artifact@v4` writes to `.artifacts/` locally (set in `.actrc`);
  that directory is gitignored.
- For faster repeat runs offline, add `--action-offline-mode` (pulls only what is
  missing, then reuses the local cache).
- `act` config precedence: an `.actrc` in your home directory is read before the
  repo one, and CLI flags win over both.
