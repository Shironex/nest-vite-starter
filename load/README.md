# API load testing

Synthetic load testing for the API (`apps/api`) with [k6](https://k6.io). Drives
realistic, authenticated traffic against the tRPC + REST surface, finds the
throughput ceilings, and renders a report you can read.

> Run against dev only, never a real production deployment. A prod run pollutes
> real data and can trip rate limits / billing. See [Safety](#safety).

This harness ships as a runnable skeleton: a read-only mixed profile
(`user.me` / `sessions.list` / `ping.ping` + occasional re-login) that runs
single-user for `smoke` and across an auto-seeded user pool for the heavier
scenarios. A product fork adds its own write profiles.

---

## TL;DR

```bash
# 1. Bring up the stack (DB + redis + mailpit) and migrate
docker compose up -d
pnpm --filter @repo/database db:migrate:deploy

# 2. Seed a login-able admin. db:seed loads packages/database/.env then the
#    repo-root .env, so ADMIN_EMAIL / ADMIN_PASSWORD are picked up with no
#    flags. The harness logs in as this account for smoke. (Pool scenarios
#    auto-seed their own users, step 4.) A real env var still wins over both
#    files, so prefixing the command with ADMIN_EMAIL=... is still a valid
#    per-run override. `pnpm load smoke --seed` after step 3 runs this for you.
pnpm --filter @repo/database db:seed

# 3. Start the API with the auth threadpool raised (see "Why these env vars")
UV_THREADPOOL_SIZE=16 pnpm --filter @repo/api dev

# 4. Run a load test, generates an HTML report + updates the gallery
pnpm load smoke               # 1 VU, 30s, run this first, every time
pnpm load baseline --xff      # 10 VU, ~2m, the "before" numbers
pnpm load stress --xff        # ramp 0->200 VU, find the knee
pnpm load spike --xff         # burst 0->100 VU, throttle shed + recovery
pnpm load soak --xff          # 50 VU, 30m, slow drift (leaks, queue creep)
```

`smoke` logs in as the seeded admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, read from
the repo-root `.env` automatically, no manual `export` needed). The heavier
scenarios auto-seed a pool of `load-user-N@example.test` accounts (one per peak
VU) and round-robin VUs across them; add `--xff` host-native so each VU also
gets its own per-IP auth rate-limit bucket (see [Concurrency
limits](#concurrency-limits-you-will-hit)). Open `load/reports/index.html` for
the gallery, or the per-run report linked from it.

---

## Prerequisites

**k6** (host-native is the default and gives the most accurate client latency):

| OS      | Install                                            |
| ------- | -------------------------------------------------- |
| macOS   | `brew install k6`                                  |
| Windows | `winget install k6.k6` or `choco install k6`       |
| Linux   | see <https://k6.io/docs/get-started/installation/> |

No k6 binary? The CLI falls back to the `grafana/k6` Docker image automatically
(it rewrites `localhost` -> `host.docker.internal`). Force it with
`pnpm load smoke --docker`. The Docker path can't use the per-VU XFF throttler
bypass (see below).

---

## The CLI

```text
pnpm load <scenario> [flags]
```

| Flag               | Effect                                                             |
| ------------------ | ------------------------------------------------------------------ |
| `--url=<url>`      | Target API base URL (default `http://localhost:3000`)              |
| `--users=<n>`      | Pool size for heavy scenarios (default: one account per peak VU)   |
| `--no-seed`        | Skip the (pool) seed; assume the accounts already exist            |
| `--seed`           | (smoke) seed the admin user via `db:seed` before running           |
| `--prometheus`     | Stream k6's own metrics into a Prometheus (remote-write)           |
| `--xff`            | Per-VU `X-Forwarded-For` throttler bypass (host-native + loopback) |
| `--docker`         | Force the `grafana/k6` Docker image                                |
| `--no-dashboard`   | Skip the k6 web-dashboard HTML export                              |
| `--skip-preflight` | Don't check `/health` first                                        |

Credentials are loaded from the repo-root `.env` automatically, so a plain
`pnpm load smoke` works without exporting anything. Override the login per run
with `LOAD_USER_EMAIL` / `LOAD_USER_PASSWORD` (shell exports win over `.env`).

Each run writes `load/reports/<scenario>-<timestamp>.html` (interactive k6 web
dashboard), a `.summary.json` (machine-readable), and rebuilds
`load/reports/index.html` (the gallery). `pnpm load:report` rebuilds the gallery
without running a test.

---

## Concurrency limits you will hit

Three app-level limits bound a heavy run. They are real protections, not harness
bugs, the harness works **around** them, it does not relax them.

- **Per-IP auth rate limit `10 logins / 60s / IP`** (`auth-shared.service.ts`,
  `enforceAuthRateLimit`). This is the tightest limiter on the login path and
  the one that bites first: every VU logging in from one host shares a single
  loopback IP, so the 11th login in a minute gets `RATE_LIMITED`. A VU whose
  login is rate-limited never gets a session and then 401s on every read. Spread
  it with `--xff` (one IP bucket per VU). Keyed on `req.ip`, which Express
  derives from `X-Forwarded-For` because `trust proxy = loopback`.
- **`MAX_SESSIONS = 3` per user** (`session.service.ts`). The 4th concurrent
  login on one account evicts the oldest session. With the ~5% auth-churn
  re-login, even 2 VUs sharing an account eventually push it past 3 sessions and
  evict a live peer's session (whose reads then 401). The pool defaults to **one
  account per peak VU** to remove this, a churn login then only evicts the VU's
  own stale session.
- **Global throttler `100 req / 60s`** (`app.module.ts`, hard-coded). From one
  load generator that trips in seconds; `--xff` spreads it the same way (per-VU
  bucket).

How the CLI runs a heavy scenario honestly (this is automatic):

1. **An auto-seeded user pool.** Every non-`smoke` scenario seeds a pool of
   `load-user-0@example.test` … `load-user-(N-1)@example.test` (via
   `db:seed:load`, password `load-test-password`, override with
   `LOAD_USER_PASSWORD`) and round-robins VUs across them. Defaults to one
   account per peak VU; size it with `--users=N`, skip the seed with `--no-seed`.
   The pool seed is idempotent and resets each account's lockout on every run, so
   a poisoned prior run can't keep the pool red.
2. **The XFF bypass (host-native only).** Add `--xff` so each VU sends a distinct
   `X-Forwarded-For`, giving it its own per-IP auth-rate-limit + throttler
   bucket. Required to stay green above ~5 VUs. It does **not** work from Docker
   (the source IP is a Docker-network address) and does not lift the session cap,
   so it pairs with the pool. Verified clean: `pnpm load baseline --xff` →
   0% errors, all thresholds.

---

## Why these env vars

- **`UV_THREADPOOL_SIZE`** (default `4`). Argon2id password hashing
  (`@node-rs/argon2`) runs on libuv's worker pool, so the default caps concurrent
  logins to ~4 in-flight regardless of CPU count. Raise it (`16`, about 2x cores)
  to lift the auth ceiling, then re-measure. **libuv reads this from the process
  environment before the app's `.env` loads**, so export it at launch
  (`UV_THREADPOOL_SIZE=16 pnpm --filter @repo/api dev`), not in `.env`.
- **`ADMIN_EMAIL` / `ADMIN_PASSWORD`**. The seed creates the admin from these,
  and the harness logs in as that account by default. Keep them consistent
  between seed and run, or pass `LOAD_USER_EMAIL` / `LOAD_USER_PASSWORD`.

---

## Reading the results

- **Per-run k6 report**: `load/reports/<run>.html`, client-side latency
  distribution, RPS, checks, thresholds, over time.
- **Server-side metrics**: the API exposes Prometheus metrics at `/metrics`
  (basic-auth gated by `METRICS_BASIC_AUTH`). Read **per-procedure** throughput /
  errors / p95 from `trpc_procedure_duration_seconds{procedure,type,ok}`. A tRPC
  batch is **one** HTTP request, so k6's HTTP request counter is _not_
  per-procedure, always use the tRPC histogram for per-procedure numbers.
- **`--prometheus`** streams k6's client metrics into a Prometheus (remote-write)
  so the client-vs-server p95 gap is visible side by side.

### Expected ceilings (in the order load hits them)

1. **Session cap / throttler** on a single-account run (see above), unless pooled / bypassed.
2. **Argon2id login threadpool** (~`UV_THREADPOOL_SIZE` concurrent hashes).
3. **Prisma pool** (`DB_POOL_MAX=10`), read fan-out saturates it; surplus
   requests should fail fast (not hang).
4. **Redis** (shared by throttler + sessions + BullMQ + socket.io).

---

## Safety

- **Default target is dev.** Don't point this at a real deployment: it writes /
  reads real data and trips production rate limits.
- The shipped profile is **read-only** (no writes to clean up). A product fork
  that adds write profiles should make them clean up after themselves and only
  run them against a disposable dev DB.

---

## Layout

```text
load/
  cli.mjs                 orchestrator: detect k6/docker, preflight, run, report
  report.mjs              rebuild the gallery from existing summaries
  lib/gallery.mjs         renders load/reports/index.html
  k6/
    lib/                  config · trpc (superjson, single-entry batch) · auth (CSRF+session) · iteration · summary
    scenarios/            smoke · baseline · stress · spike · soak
  reports/                generated (git-ignored)
```

---

## Follow-ups (out of scope for the initial harness)

- **`db:seed:load`**: a multi-user pool seed (N `load-user-*` accounts) so heavy
  scenarios spread across distinct accounts without manual seeding.
- **Write profiles**: once the product has user-owned domain data, add
  create/update profiles that clean up after themselves.
- **Per-route throttle policy**: tune auth-tight / read-generous limits from the
  load numbers (the throttler limit is currently a single hard-coded value).

```

```
