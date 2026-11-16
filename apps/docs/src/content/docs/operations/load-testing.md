---
title: Load Testing and Performance
description: The k6 load-testing harness that exists in the repo, its scenarios, safety rules, and what performance work remains recommended-but-undone.
sidebar:
  order: 7
---

## Status

Load testing **is implemented** in this repo, at `load/` (repo root): a k6-based harness for local/manual use. It is **not** wired into CI as an automated gate (see [Gaps](#gaps) below).

Full documentation lives in `load/README.md`; this page summarizes it and cross-references the rest of the observability/security docs it depends on.

## What's there

```text
load/
  cli.mjs                 orchestrator: detect k6/docker, preflight, run, report
  report.mjs               rebuild the gallery from existing summaries
  lib/gallery.mjs          renders load/reports/index.html
  k6/
    lib/                   config, trpc (superjson-aware single-entry batch client),
                            auth (CSRF + session handling), iteration, summary
    scenarios/             smoke, baseline, stress, spike, soak
  reports/                 generated output (gitignored)
```

The shipped profile is **read-only**: `user.me`, `sessions.list`, `ping.ping`, plus an occasional re-login to exercise the auth path. `smoke` runs single-user; the heavier scenarios (`baseline`, `stress`, `spike`, `soak`) run across an auto-seeded pool of accounts. There are no write-profile scenarios yet. Adding one is expected work as the product's domain surfaces take real load, and any such profile has to clean up after itself.

## Running it

```sh
# 1. Bring up the stack and migrate
docker compose up -d
pnpm --filter @repo/database db:migrate:deploy

# 2. Seed a login-able admin. db:seed loads packages/database/.env then the
#    repo-root .env, so ADMIN_EMAIL / ADMIN_PASSWORD need no flags. A real env
#    var still wins over both files if you want a per-run override.
pnpm --filter @repo/database db:seed

# 3. Start the API with a raised libuv threadpool (see "Why these env vars" below)
UV_THREADPOOL_SIZE=16 pnpm --filter @repo/api dev

# 4. Run a scenario
pnpm load smoke               # 1 VU, 30s, run this first, every time
pnpm load baseline --xff      # 10 VU, ~2m, the "before" numbers
pnpm load stress --xff        # ramp 0->200 VU, find the knee
pnpm load spike --xff         # burst 0->100 VU, throttle-shed + recovery
pnpm load soak --xff          # 50 VU, 30m, slow drift (leaks, queue creep)
```

Credentials load automatically from the repo-root `.env` (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), so plain `pnpm load smoke` works with no manual export. Override per run with `LOAD_USER_EMAIL`/`LOAD_USER_PASSWORD` (shell exports win over `.env`).

k6 itself is expected host-native (`brew install k6` on macOS, `winget install k6.k6` / `choco install k6` on Windows) for the most accurate client-side latency. With no k6 binary found, the CLI falls back automatically to the `grafana/k6` Docker image (rewriting `localhost` to `host.docker.internal`); force it explicitly with `--docker`. The Docker path cannot use the per-VU `X-Forwarded-For` bypass described below.

Each run writes `load/reports/<scenario>-<timestamp>.html` (an interactive k6 web-dashboard export), a `.summary.json` (machine-readable), and rebuilds `load/reports/index.html` (a gallery of all runs). `pnpm load:report` rebuilds the gallery without running anything.

### CLI flags

| Flag               | Effect                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| `--url=<url>`      | Target API base URL (default `http://localhost:3000`)                   |
| `--users=<n>`      | Pool size for heavy scenarios (default: one account per peak VU)        |
| `--no-seed`        | Skip the pool seed; assume accounts already exist                       |
| `--seed`           | (`smoke` only) seed the admin via `db:seed` first                       |
| `--prometheus`     | Stream k6's own client metrics into a Prometheus remote-write endpoint  |
| `--xff`            | Per-VU `X-Forwarded-For` throttler bypass (host-native + loopback only) |
| `--docker`         | Force the `grafana/k6` Docker image                                     |
| `--no-dashboard`   | Skip the k6 web-dashboard HTML export                                   |
| `--skip-preflight` | Don't check `/health` before starting                                   |

## Concurrency limits the harness deliberately works around, not relaxes

Three real application protections bound how much load a single run can honestly generate, the harness works **around** them (via a user pool and per-VU IP spreading), it does not disable them:

1. **Per-IP auth rate limit, 10 logins / 60s / IP** (`auth-shared.service.ts`, `enforceAuthRateLimit`). Every VU logging in from one host shares a single loopback IP, so the 11th login in a minute gets `RATE_LIMITED` and that VU never gets a session. `--xff` gives each VU its own `X-Forwarded-For` value and therefore its own rate-limit bucket (keyed on `req.ip`, which Express derives from `X-Forwarded-For` because the API's `trust proxy` setting is `loopback`).
2. **`MAX_SESSIONS = 3` per user** (`session.service.ts`). A 4th concurrent login on one account evicts the oldest session; with the harness's ~5% auth-churn re-login rate, even two VUs sharing an account eventually evict a live peer's session. The pool (one account per peak VU, `load-user-0@example.test` ... `load-user-(N-1)@example.test`, via `db:seed:load`, password `load-test-password`) removes this, a churn login then only evicts the VU's own stale session.
3. **Global throttler, 100 req / 60s** (hard-coded in `app.module.ts`). One load generator trips this in seconds; `--xff` spreads it the same way as the auth limit.

Expected order in which a heavy run hits its ceiling: (1) session cap/throttler on an unpooled/unbypassed run, (2) the Argon2id login threadpool (roughly `UV_THREADPOOL_SIZE` concurrent password hashes), (3) the Prisma connection pool (`DB_POOL_MAX=10` by default, surplus requests should fail fast, not hang), (4) Redis (shared by the throttler, sessions, BullMQ, and the socket.io adapter).

### Why `UV_THREADPOOL_SIZE` matters

Argon2id password hashing (`@node-rs/argon2`) runs on libuv's worker pool, so the Node default (`4`) caps concurrent logins to about 4 in-flight regardless of CPU count. Raise it (`16`, roughly 2x cores) to lift the auth ceiling before measuring anything else. Because libuv reads this from the process environment **before** the app's own `.env` loads, it must be exported at process launch (`UV_THREADPOOL_SIZE=16 pnpm --filter @repo/api dev`), not placed in `.env`.

## Reading results

- **Client-side**: the per-run `load/reports/<run>.html` k6 web dashboard, latency distribution, RPS, checks, thresholds, over time.
- **Server-side**: the API's own Prometheus `/metrics` endpoint (basic-auth gated by `METRICS_BASIC_AUTH`: see the observability doc). Read **per-procedure** throughput/errors/p95 from `trpc_procedure_duration_seconds{procedure,type,ok}`. A tRPC batch is a single HTTP request, so k6's HTTP request counter is not per-procedure, the tRPC histogram is the only correct source for per-procedure numbers.
- **`--prometheus`**: streams k6's own client metrics into a Prometheus remote-write target so the client-vs-server p95 gap is visible side by side (pairs naturally with the optional LGTM observability overlay, see the observability doc).

## Safety

- **Dev only, never point this at a real production deployment.** It writes and reads real data and will trip production rate limits.
- The shipped profile is read-only by design (no cleanup needed). Any write-profile addition should clean up after itself and only run against a disposable dev database.

## Gaps

- **No CI gate**: the harness is manual/local today. A k6 smoke job in CI emitting a JSON baseline for drift detection is the natural next step.
- **No write-profile scenarios**: only reads (`user.me`, `sessions.list`, `ping.ping`) plus re-login churn. The README's own "Follow-ups" section lists this explicitly, along with a multi-user `db:seed:load` pool seed (already implemented) and per-route throttle tuning informed by real load numbers (still open, the throttler is currently one hard-coded global value, not tuned per-route).
- **No documented performance SLOs.** Performance budgets (e.g. P95 tRPC < 200ms, P99 DB query < 100ms) are needed to turn the Prometheus alert on tRPC p99 latency (`ApiHighP99Latency`, currently fixed at a 2s threshold, see the observability doc) into something backed by an actual target rather than an arbitrary round number.
- **No read-replica or HTTP-caching layer**: candidates are `@prisma/extension-read-replicas` and a tRPC `cacheable()` helper with `Cache-Control`/ETag for read-heavy endpoints; neither exists yet.
- **No pagination convention enforced repo-wide**: `findMany` calls without `take`/`skip`/cursor are not blocked by lint; this affects how load scales on any future list endpoint, since unbounded reads under load are a likely first bottleneck.
