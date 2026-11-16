#!/usr/bin/env bash
#
# The path filter every expensive CI job asks before doing its work:
#
#   scripts/ci/affected.sh <turbo task> <turbo filter> [<turbo filter> ...]
#
# Prints `run=true` or `run=false`, and appends the same line to $GITHUB_OUTPUT
# when GitHub set one, so a step gates on `steps.<id>.outputs.run`. The jobs
# themselves always run, so a required status check is never missing; this only
# decides whether the expensive steps inside them do anything.
#
# On push and workflow_dispatch TURBO_AFFECTED is empty, the full graph runs,
# and the answer is true without asking turbo at all. On a pull request the
# task is dry-run against the PR base and the answer is false ONLY when turbo
# positively reports zero tasks.
#
# Every other outcome answers TRUE: turbo failing, printing nothing, printing
# something that is not JSON, or printing JSON with no `tasks` array. A probe
# that cannot tell must run the job. The direction matters more than the
# saving: a false `run=false` is a job that reported green without testing
# anything, which is the failure mode this whole filter could introduce.
set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: scripts/ci/affected.sh <turbo task> <turbo filter> [<turbo filter> ...]" >&2
  exit 2
fi

task="$1"
shift

emit() {
  echo "run=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "run=$1" >>"$GITHUB_OUTPUT"
  fi
}

if [ -z "${TURBO_AFFECTED:-}" ]; then
  emit true
  exit 0
fi

# `--dry=json` schedules nothing; `tasks` is what turbo would have run. node
# does the counting because a malformed or truncated body must read as "cannot
# tell" (1), not as zero.
count="$(
  pnpm exec turbo run "$task" "$@" --affected --dry=json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",(c)=>{s+=c});process.stdin.on("end",()=>{try{const t=JSON.parse(s).tasks;console.log(Array.isArray(t)?t.length:1)}catch{console.log(1)}})'
)" || count=1

# Anything that is not a plain number (no node on PATH, a killed pipeline)
# is the same "cannot tell" answer.
case "$count" in
  '' | *[!0-9]*) count=1 ;;
esac

if [ "$count" -gt 0 ]; then
  emit true
else
  emit false
fi
