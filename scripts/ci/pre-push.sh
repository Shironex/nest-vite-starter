#!/usr/bin/env bash
#
# Pre-push gate: mirrors .github/workflows/ci.yml so "passes locally, fails in
# CI" cannot happen. Every command run here (except the gitleaks secret scan,
# which mirrors a separate workflow; see below) is also listed in
# scripts/ci/pre-push.manifest.json, and the lint-meta rule `pre-push-ci-parity`
# fails the build if any manifest command is missing from ci.yml. Keep the two
# in lockstep: if you add a gate here, add it to the manifest and ci.yml too.
#
# Fast checks + the coverage ratchet run always (the api/web suites are
# self-contained and need no services). The Prisma gates need a database. They
# prefer this worktree's verification sandbox (`pnpm sandbox:up`, tools/verify)
# so parallel worktrees do not share one, and fall back to whatever answers on
# PRE_PUSH_DB_HOST:PRE_PUSH_DB_PORT (localhost:5432 by default).
#
# A gate that did not run is INCOMPLETE, not a pass. Skipping the database
# gates (or the secret scan) therefore ends in exit 2 with an explicit
# INCOMPLETE line, which still aborts the push; set PRE_PUSH_ALLOW_INCOMPLETE=1
# to push anyway. Exit 1 remains "a gate ran and failed".
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail=0
incomplete=0
run() {
  echo ""
  echo "▶ $*"
  if ! "$@"; then
    echo "✗ FAILED: $*"
    fail=1
  fi
}

# --- Secret scan (hard gate; mirrors .github/workflows/security-secrets.yml) ---
# Deliberately NOT in pre-push.manifest.json: that manifest mirrors ci.yml, but
# the gitleaks scan lives in a separate workflow (security-secrets.yml). Listing
# it would make pre-push-ci-parity require the command in ci.yml and turn the
# rule red. CI is the authoritative enforcement; this is local defense-in-depth.
#
# Cross-platform: prefers a native `gitleaks` (macOS `brew install gitleaks`,
# Windows `scoop install gitleaks`); falls back to the pinned Docker image so it
# works without a per-machine install. Set PRE_PUSH_SKIP_GITLEAKS=1 to bypass
# (mirrors PRE_PUSH_SKIP_DB; use only when neither gitleaks nor Docker exists).
#
# Version parity: CI installs the GITLEAKS_VERSION named in security-secrets.yml, and this value
# must equal it (lint-meta rule security-scanner-version-parity). Another version scans with
# another ruleset, so a native gitleaks whose `gitleaks version` differs is refused and the pinned
# image is used instead; with no Docker either, the scan fails rather than run the wrong scanner.
GITLEAKS_VERSION="8.30.1"
GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v${GITLEAKS_VERSION}"
gitleaks_scan() {
  local native_version=""
  if command -v gitleaks >/dev/null 2>&1; then
    native_version="$(gitleaks version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
    if [ "$native_version" = "$GITLEAKS_VERSION" ]; then
      gitleaks git . --config .gitleaks.toml --no-banner --redact --exit-code 1
      return
    fi
    echo "  Native gitleaks ${native_version:-of unknown version} is not CI's ${GITLEAKS_VERSION}; refusing it."
  fi
  if command -v docker >/dev/null 2>&1; then
    if ! docker info >/dev/null 2>&1; then
      echo "  Docker is installed but its daemon is not running. Start Docker,"
      echo "  install native gitleaks ${GITLEAKS_VERSION}, or set PRE_PUSH_SKIP_GITLEAKS=1 to bypass."
      return 1
    fi
    # MSYS_NO_PATHCONV stops Git Bash on Windows from mangling the -v mount path.
    MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" -w /repo "$GITLEAKS_IMAGE" \
      git . --config .gitleaks.toml --no-banner --redact --exit-code 1
  else
    echo "  No usable gitleaks: need native ${GITLEAKS_VERSION} (the one CI pins) or Docker."
    echo "  Install: macOS 'brew install gitleaks' | Windows 'scoop install gitleaks' (check"
    echo "  'gitleaks version'), or download ${GITLEAKS_VERSION} from the gitleaks GitHub releases."
    echo "  Or set PRE_PUSH_SKIP_GITLEAKS=1 to bypass (CI still enforces the scan)."
    return 1
  fi
}
if [ "${PRE_PUSH_SKIP_GITLEAKS:-0}" = "1" ]; then
  echo ""
  echo "⊘ Skipping gitleaks secret scan (PRE_PUSH_SKIP_GITLEAKS=1)."
  incomplete=1
else
  run gitleaks_scan
fi

# --- Fast checks (no services) ---
# turbo lint/check-types run the full graph locally (CI adds --affected). The
# strings below match pre-push.manifest.json, which pre-push-ci-parity checks
# against ci.yml.
run pnpm build:packages
run pnpm exec turbo lint
run pnpm exec turbo check-types
run pnpm check-types:tools
run pnpm lint:meta
run pnpm lint:tools
run pnpm test:lint-meta
run pnpm check:lint-meta-docs
run pnpm --filter @repo/api knip
run pnpm --filter @repo/web knip

# --- Coverage ratchet (self-contained, no DB) ---
run pnpm --filter @repo/api test:cov:check
run pnpm --filter @repo/web test:cov:check

# --- Prisma gates (need a reachable database) ---
# Prefer this worktree's sandbox lane over the ambient dev stack: two worktrees
# running the gates at once against one database is how `migrate:status` starts
# reporting another checkout's migrations. `sandbox:inspect` prints nothing and
# exits non-zero when no sandbox is up, so the fallback is the old behavior.
db_host="${PRE_PUSH_DB_HOST:-localhost}"
db_port="${PRE_PUSH_DB_PORT:-5432}"
lane_url="$(pnpm sandbox:inspect --lane-url=prisma_gates 2>/dev/null | tail -n 1)"
case "$lane_url" in
  postgresql://*)
    export DATABASE_URL="$lane_url"
    hostport="${lane_url#*@}"
    hostport="${hostport%%/*}"
    db_host="${hostport%%:*}"
    db_port="${hostport##*:}"
    echo ""
    echo "▶ Prisma gates will use the sandbox lane on ${db_host}:${db_port}."
    ;;
esac

# Readiness, not a bare TCP connect. A Docker-published port is accepted by the
# proxy before the server behind it listens, and any other process can hold
# 5432; both answered "up" to the old /dev/tcp probe, and the Prisma gates then
# died on a connection error that reads like a broken migration instead of "no
# database here". tools/verify/db-ready.ts speaks the Postgres startup
# handshake, so it answers the question the gate is actually asking. It runs
# through `node --import tsx` because husky invokes this hook with no
# node_modules/.bin on PATH.
db_up() { node --import tsx tools/verify/db-ready.ts "$db_host" "$db_port" >/dev/null 2>&1; }
if [ "${PRE_PUSH_SKIP_DB:-0}" = "1" ]; then
  echo ""
  echo "⊘ Skipping Prisma gates (PRE_PUSH_SKIP_DB=1)."
  incomplete=1
elif db_up; then
  run pnpm --filter @repo/database db:migrate:check
  run pnpm --filter @repo/database db:migrate:status
else
  echo ""
  echo "⊘ Skipping Prisma gates: no database reachable on ${db_host}:${db_port}."
  echo "  Start one with: pnpm sandbox:up   (or docker compose up -d postgres)"
  incomplete=1
fi

echo ""
if [ "$fail" -ne 0 ]; then
  echo "✗ pre-push checks failed. Push aborted."
  exit 1
fi
if [ "$incomplete" -ne 0 ] && [ "${PRE_PUSH_ALLOW_INCOMPLETE:-0}" != "1" ]; then
  echo "⚠ pre-push INCOMPLETE: a gate above did not run, so this push is unverified."
  echo "  Start the services (pnpm sandbox:up) and retry, or set"
  echo "  PRE_PUSH_ALLOW_INCOMPLETE=1 to push anyway."
  exit 2
fi
if [ "$incomplete" -ne 0 ]; then
  echo "✓ pre-push checks passed, INCOMPLETE (PRE_PUSH_ALLOW_INCOMPLETE=1)."
  exit 0
fi
echo "✓ pre-push checks passed."
