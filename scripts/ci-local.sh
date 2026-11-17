#!/usr/bin/env bash
#
# Run the GitHub Actions CI workflow locally with `act`, including the
# service-bound jobs (test-api, test-e2e).
#
# Service jobs reach postgres/redis at localhost:<port>. Under `act` the job
# runs inside a container, so localhost only resolves to the service ports when
# the job is on the host network (.actrc sets --network=host) AND those host
# ports are free. The local dev stack publishes the same ports (5432/6379), so
# for a service run this wrapper stops any container holding a CI service port
# first, then restores the dev stack afterwards (via `docker compose up -d` when
# a compose file is present, which reliably re-binds the host ports).
#
# Modes:
#   scripts/ci-local.sh                 # whole workflow: each job as its OWN
#                                       # `act -j` run, sequentially. Separate
#                                       # runs are required because act keeps a
#                                       # service job's postgres on host:5432
#                                       # until the run ends, so two service
#                                       # jobs in one `act` call collide. This
#                                       # is the thorough, slow command (quality
#                                       # re-runs as a prerequisite of several
#                                       # jobs; there is no act flag to skip it).
#   scripts/ci-local.sh -j test-e2e     # single job
#   CI_LOCAL_JOBS="test-api test-e2e" scripts/ci-local.sh   # custom subset
#
# A single-run lock prevents two local CI runs from colliding (they fight over
# host ports and over per-package build temp files). A stale lock from a killed
# run is auto-reclaimed. If a run is hard-killed, restore the dev stack with:
#   docker compose up -d

set -uo pipefail

# Every host port a CI service job binds. The dev stack publishes the same
# ones, so a container holding any of them is stopped for the run and the
# stack is restored afterwards. 1025/8025 are the mailpit service the mail
# journeys of test-e2e need.
CI_PORTS="5432 6379 1025 8025"
SERVICE_JOBS="test-api test-e2e"
ALL_JOBS_DEFAULT="quality build test-web test-api test-e2e"
LOCK_DIR="${TMPDIR:-/tmp}/nest-vite-starter-act-ci-local.lock"
SETTLE_SECONDS=4

cd "$(dirname "$0")/.." || exit 1

command -v act >/dev/null 2>&1 || {
  echo "error: act is not installed. Install with: brew install act" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "error: Docker is not running." >&2
  exit 1
}

# --- single-run lock (auto-reclaims a stale lock left by a killed run) --------
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  oldpid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    echo "error: another local CI run is active (pid $oldpid, lock: $LOCK_DIR)." >&2
    echo "       Wait for it to finish before starting another." >&2
    exit 1
  fi
  echo ">> clearing stale lock from a previous run (pid ${oldpid:-unknown})"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || {
    echo "error: could not acquire lock at $LOCK_DIR" >&2
    exit 1
  }
fi
echo $$ >"$LOCK_DIR/pid"

# --- helpers ------------------------------------------------------------------
list_has_service_job() {
  for j in "$@"; do
    for s in $SERVICE_JOBS; do [ "$j" = "$s" ] && return 0; done
  done
  return 1
}

STOPPED=""
free_ports() {
  for port in $CI_PORTS; do
    names=$(docker ps --filter "publish=${port}" --format '{{.Names}}' 2>/dev/null)
    [ -n "$names" ] && STOPPED="$STOPPED $names"
  done
  STOPPED=$(printf '%s\n' $STOPPED | sort -u | xargs)
  if [ -n "$STOPPED" ]; then
    echo ">> freeing CI ports ($CI_PORTS); stopping: $STOPPED"
    docker stop $STOPPED >/dev/null
  fi
}

cleanup() {
  if [ -n "$STOPPED" ]; then
    echo ">> restoring local containers: $STOPPED"
    if [ -f docker-compose.yml ]; then
      # `up -d` reconciles the dev stack to the compose spec and re-binds the
      # host ports even if a prior `docker start` lost them racing act teardown.
      docker compose up -d >/dev/null 2>&1 || docker start $STOPPED >/dev/null 2>&1 || true
    else
      for _ in 1 2 3 4 5; do docker start $STOPPED >/dev/null 2>&1 && break; sleep 2; done
    fi
  fi
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- all-jobs mode: one `act -j` run per job, sequentially --------------------
if [ "$#" -eq 0 ]; then
  JOBS=${CI_LOCAL_JOBS:-$ALL_JOBS_DEFAULT}
  list_has_service_job $JOBS && free_ports
  echo ">> ci:local:all - sequential per-job act runs: $JOBS"

  summary=""
  overall=0
  first=1
  for j in $JOBS; do
    [ $first -eq 0 ] && sleep "$SETTLE_SECONDS"
    first=0
    echo ""
    echo ">> ===== act -j $j ====="
    if act -j "$j"; then
      summary="${summary}
  PASS  $j"
    else
      summary="${summary}
  FAIL  $j"
      overall=1
    fi
  done

  echo ""
  echo ">> ===== ci:local:all summary ====="
  printf '%s\n' "$summary"
  [ $overall -eq 0 ] && echo ">> all jobs passed" || echo ">> some jobs FAILED (see logs above)"
  exit $overall
fi

# --- single-job / passthrough mode --------------------------------------------
job=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-j" ] || [ "$prev" = "--job" ]; then job="$a"; fi
  prev="$a"
done
[ -n "$job" ] && list_has_service_job "$job" && free_ports

echo ">> act $*"
act "$@"
exit $?
