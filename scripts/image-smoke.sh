#!/bin/sh
# Container smoke tests for the two images. POSIX sh; runs the same on a Mac, on
# Linux and in CI (the `images` job calls it).
#
#   scripts/image-smoke.sh [--build] [api|web|all]
#
#   --build   build both images first (otherwise they must already exist)
#
# Images come from API_IMAGE and WEB_IMAGE (default nest-vite-starter-api:ci and
# nest-vite-starter-web:ci). Needs docker, curl and node on the PATH.
#
# api: boots as uid 10001 with a read-only root, no capabilities and no
#      new-privileges, on a docker network with NO route out (--internal), next to
#      Postgres and Valkey from docker-compose.yml. Checks the one-shot `migrate`
#      form, the in-container migration, RUN_MIGRATIONS=false, and /health/ready.
# web: checks the SPA's nested route (asset URLs absolute and served as JavaScript,
#      a missing asset is a 404), the cache and security headers, the runtime
#      /config.js with a hostile value, and the refusal of an unsafe or multi-line
#      API_URL or API_UPSTREAM.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
API_IMAGE=${API_IMAGE:-nest-vite-starter-api:ci}
WEB_IMAGE=${WEB_IMAGE:-nest-vite-starter-web:ci}
RUN_ID="nvs-smoke-$$"
NETWORK="$RUN_ID"
BUILD=0
TARGET=all

for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    api | web | all) TARGET=$arg ;;
    *) echo "usage: $0 [--build] [api|web|all]" >&2; exit 2 ;;
  esac
done

FAILED=0
QUIET=0
pass() { [ "$QUIET" = 1 ] || printf 'ok    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; FAILED=$((FAILED + 1)); }
check() { # check "description" command...
  desc=$1
  shift
  if "$@" > /dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

TMP=$(mktemp -d)
cleanup() {
  rm -rf "$TMP"
  # By name prefix: start_web runs in a command substitution, so a list kept in a
  # variable would never see its containers.
  docker ps -aq --filter "name=$RUN_ID-" | while read -r c; do
    docker rm -f "$c" > /dev/null 2>&1 || true
  done
  docker network rm "$NETWORK" > /dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The pinned service images are read from docker-compose.yml so there is one pin.
compose_image() {
  awk -v prefix="$1" '$1 == "image:" && index($2, prefix) == 1 { print $2; exit }' "$ROOT/docker-compose.yml"
}

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

# Polls "$@" until it succeeds, for up to $WAIT_SECONDS (default 90).
wait_for() {
  desc=$1
  shift
  i=0
  while [ "$i" -lt "${WAIT_SECONDS:-90}" ]; do
    if "$@" > /dev/null 2>&1; then pass "$desc"; return 0; fi
    i=$((i + 1))
    sleep 1
  done
  fail "$desc (gave up after ${WAIT_SECONDS:-90}s)"
  return 1
}

if [ "$BUILD" = 1 ]; then
  docker build -f "$ROOT/apps/api/Dockerfile" -t "$API_IMAGE" "$ROOT"
  docker build -f "$ROOT/apps/web/Dockerfile" -t "$WEB_IMAGE" "$ROOT"
fi

# ---------------------------------------------------------------------------
# api
# ---------------------------------------------------------------------------
smoke_api() {
  echo "== api ($API_IMAGE)"
  PG_IMAGE=$(compose_image postgres:)
  VALKEY_IMAGE=$(compose_image valkey/valkey:)
  [ -n "$PG_IMAGE" ] && [ -n "$VALKEY_IMAGE" ] || { fail "found the postgres and valkey pins in docker-compose.yml"; return; }

  PG_PASS=$(random_hex 12)
  REDIS_PASS=$(random_hex 12)
  # --internal: containers on this network can reach each other and nothing else.
  docker network create --internal "$NETWORK" > /dev/null

  docker run -d --name "$RUN_ID-pg" --network "$NETWORK" --network-alias postgres \
    -e POSTGRES_USER=app -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_DB=app \
    "$PG_IMAGE" > /dev/null
  docker run -d --name "$RUN_ID-valkey" --network "$NETWORK" --network-alias redis \
    -e REDIS_PASSWORD="$REDIS_PASS" "$VALKEY_IMAGE" \
    sh -c 'exec valkey-server --requirepass "$REDIS_PASSWORD"' > /dev/null

  # Postgres reports ready twice (a temporary init server answers first), so
  # probe over TCP, which only the real server serves, and require 3 in a row.
  pg_ready() {
    n=0
    while [ "$n" -lt 3 ]; do
      docker exec "$RUN_ID-pg" pg_isready -h 127.0.0.1 -U app -d app > /dev/null || return 1
      n=$((n + 1))
      sleep 1
    done
  }
  wait_for "postgres is ready" pg_ready || return
  wait_for "valkey is ready" docker exec -e "REDISCLI_AUTH=$REDIS_PASS" "$RUN_ID-valkey" valkey-cli ping || return

  # A production-shaped config, so the boot also proves the env schema accepts one.
  set -- \
    --network "$NETWORK" --read-only --tmpfs /tmp --cap-drop ALL \
    --security-opt no-new-privileges:true \
    -e NODE_ENV=production -e PORT=3000 \
    -e "DATABASE_URL=postgresql://app:$PG_PASS@postgres:5432/app" \
    -e "REDIS_URL=redis://:$REDIS_PASS@redis:6379" \
    -e APP_URL=https://app.example.com -e TRUST_PROXY=1 \
    -e "CSRF_SECRET=$(random_hex 32)" -e "ENCRYPTION_KEY=$(random_hex 32)" \
    -e SMTP_HOST=smtp.example.com -e SMTP_PORT=587 -e SMTP_USER=smoke -e SMTP_PASS=smoke \
    -e MAIL_FROM=noreply@example.com -e CAPTCHA_DISABLED=true

  # The one-shot form that docker-compose.prod.yml runs.
  if docker run --rm --name "$RUN_ID-migrate" "$@" "$API_IMAGE" migrate > "$TMP/migrate.log" 2>&1; then
    pass "one-shot migrate exits 0"
  else
    fail "one-shot migrate exits 0"
    cat "$TMP/migrate.log" >&2
  fi

  # As compose runs it: migrations skipped, the migrate service already did them.
  docker run -d --name "$RUN_ID-api" -e RUN_MIGRATIONS=false "$@" "$API_IMAGE" > /dev/null
  ready() { docker exec "$RUN_ID-api" wget -q -O - http://127.0.0.1:3000/health/ready | grep -q '"status":"ok"'; }
  wait_for "api answers /health/ready" ready || { docker logs "$RUN_ID-api" >&2; return; }
  check "api runs as uid 10001" test "$(docker exec "$RUN_ID-api" id -u)" = 10001
  check "api runs as gid 10001" test "$(docker exec "$RUN_ID-api" id -g)" = 10001
  check "RUN_MIGRATIONS=false skips the in-container migration" \
    sh -c "! docker logs $RUN_ID-api 2>&1 | grep -q 'prisma migrate deploy'"
  check "api's root filesystem is read-only" \
    sh -c "! docker exec $RUN_ID-api sh -c 'touch /app/x' 2>/dev/null"

  # The default: the entrypoint migrates, then starts.
  docker run -d --name "$RUN_ID-api2" "$@" "$API_IMAGE" > /dev/null
  ready2() { docker exec "$RUN_ID-api2" wget -q -O - http://127.0.0.1:3000/health/ready | grep -q '"status":"ok"'; }
  wait_for "api migrates in its entrypoint, then answers /health/ready" ready2 || docker logs "$RUN_ID-api2" >&2
  check "the default entrypoint ran the migration" \
    sh -c "docker logs $RUN_ID-api2 2>&1 | grep -q 'prisma migrate deploy'"
}

# ---------------------------------------------------------------------------
# web
# ---------------------------------------------------------------------------
# Starts a web container with the given -e arguments; prints its base URL.
start_web() {
  name=$1
  shift
  docker run -d --name "$name" --read-only --tmpfs /tmp --cap-drop ALL \
    --security-opt no-new-privileges:true -p 127.0.0.1::8080 "$@" "$WEB_IMAGE" > /dev/null
  port=$(docker port "$name" 8080/tcp | head -n 1 | sed 's/.*://')
  echo "http://127.0.0.1:$port"
}

smoke_web() {
  echo "== web ($WEB_IMAGE)"
  base=$(start_web "$RUN_ID-web" -e API_URL=https://api.example.com)
  up() { curl -fsS "$base/healthz" | grep -q ok; }
  wait_for "web answers /healthz" up || { docker logs "$RUN_ID-web" >&2; return; }
  check "web runs as uid 10001" test "$(docker exec "$RUN_ID-web" id -u)" = 10001

  # A nested route: the SPA fallback answers it with index.html.
  if ! curl -fsS -o "$TMP/login.html" "$base/auth/login"; then fail "GET /auth/login"; return; fi
  check "/auth/login serves the app shell" grep -q '<div id="root">' "$TMP/login.html"
  check "/auth/login loads /config.js before the app" grep -q 'src="/config.js"' "$TMP/login.html"

  # Every script and stylesheet URL must be absolute (base '/'), and must come
  # back as the right type. A relative base makes /auth/login ask for
  # /auth/assets/*.js, which the SPA fallback answers with index.html.
  grep -Eo '(src|href)="[^"]+\.(js|css)"' "$TMP/login.html" | sed 's/^[a-z]*="//; s/"$//' > "$TMP/refs"
  check "the app shell references scripts and styles" test -s "$TMP/refs"
  QUIET=1
  asset_count=0
  failed_before=$FAILED
  while read -r ref; do
    asset_count=$((asset_count + 1))
    case "$ref" in
      /*) pass "asset URL is absolute: $ref" ;;
      *) fail "asset URL is absolute: $ref" ;;
    esac
    ctype=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$base$ref" || true)
    case "$ref" in
      *.js) case "$ctype" in "200 "*javascript*) pass "$ref is JavaScript" ;; *) fail "$ref is JavaScript (got: $ctype)" ;; esac ;;
      *.css) case "$ctype" in "200 "*text/css*) pass "$ref is CSS" ;; *) fail "$ref is CSS (got: $ctype)" ;; esac ;;
    esac
  done < "$TMP/refs"
  QUIET=0
  [ "$FAILED" = "$failed_before" ] && pass "all $asset_count asset URLs are absolute and served with the right type"
  status=$(curl -sS -o /dev/null -w '%{http_code}' "$base/assets/missing-asset.js" || true)
  check "a missing asset is a 404, not index.html" test "$status" = 404
  first_asset=$(grep '^/assets/' "$TMP/refs" | head -n 1)
  curl -sS -D - -o /dev/null "$base$first_asset" | tr -d '\r' | tr 'A-Z' 'a-z' > "$TMP/asset.headers"
  check "a hashed asset is cacheable for a year" grep -q 'max-age=31536000' "$TMP/asset.headers"

  # Headers: no-cache on the shell and the config, and the security headers kept.
  for path in /auth/login /config.js; do
    curl -sS -D - -o /dev/null "$base$path" | tr -d '\r' | tr 'A-Z' 'a-z' > "$TMP/headers"
    check "$path sends cache-control: no-cache" grep -q '^cache-control: no-cache' "$TMP/headers"
    check "$path keeps the content-security-policy" grep -q '^content-security-policy: default-src' "$TMP/headers"
    check "$path keeps x-content-type-options" grep -q '^x-content-type-options: nosniff' "$TMP/headers"
  done
  check "/config.js is JavaScript" grep -q '^content-type: .*javascript' "$TMP/headers"
  check "API_URL joins the CSP connect-src" grep -q "connect-src 'self' https://api.example.com " "$TMP/headers"

  # A hostile value: quotes, a backslash, a script end tag, a newline, a Unicode
  # line separator and paragraph separator, and shell metacharacters.
  hostile=$(printf 'a"b\\c</script><script>alert(1)</script>\nline2\342\200\250sep\342\200\251end\47$(id)`id`;')
  appname=$(printf 'Caf\303\251 "Quoted" Inc.')
  hbase=$(start_web "$RUN_ID-web-hostile" -e "TURNSTILE_SITE_KEY=$hostile" -e "APP_NAME=$appname" -e SENTRY_DSN=)
  hup() { curl -fsS "$hbase/healthz" | grep -q ok; }
  wait_for "web with a hostile config value starts" hup || { docker logs "$RUN_ID-web-hostile" >&2; return; }
  curl -fsS -o "$TMP/config.js" "$hbase/config.js"
  tr -d '\n' < "$TMP/config.js" > "$TMP/config.oneline"
  check "config.js holds only printable ASCII (nothing to break out with)" \
    sh -c '! LC_ALL=C grep -q "[^ -~]" "$1"' _ "$TMP/config.oneline"
  check "config.js has no script end tag" sh -c '! grep -qi "</script" "$1"' _ "$TMP/config.js"
  # Evaluate it the way a browser would and compare every value byte for byte.
  cat > "$TMP/roundtrip.js" <<'JS'
const vm = require('node:vm');
const src = require('node:fs').readFileSync(process.argv[2], 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(src, sandbox);
const c = sandbox.window.__APP_CONFIG__;
const ok =
  c &&
  c.TURNSTILE_SITE_KEY === process.env.EXPECT_KEY &&
  c.APP_NAME === process.env.EXPECT_NAME &&
  c.SENTRY_DSN === '' &&
  c.API_URL === '';
process.exit(ok ? 0 : 1);
JS
  check "a hostile value round-trips through config.js unchanged" \
    env "EXPECT_KEY=$hostile" "EXPECT_NAME=$appname" node "$TMP/roundtrip.js" "$TMP/config.js"

  # An unsafe API_URL must stop the container, and the message must not echo it.
  code=0
  docker run --rm --read-only --tmpfs /tmp -e 'API_URL=https://evil.example.com/path";x' "$WEB_IMAGE" > "$TMP/refusal.log" 2>&1 || code=$?
  check "an unsafe API_URL stops the container" test "$code" -ne 0
  check "the refusal does not echo the value" sh -c '! grep -q evil "$1"' _ "$TMP/refusal.log"

  # A multi-line API_URL or API_UPSTREAM whose first line is a valid origin. grep
  # matches line by line, so without the single-line check the second line lands
  # in nginx's config as a directive. The newline is a literal: $(printf '\n')
  # would lose a trailing one to command substitution.
  nl='
'
  cr=$(printf '\r')
  injected='location = /x { return 200 injected; }'
  for var in API_URL API_UPSTREAM; do
    origin=https://api.example.com
    [ "$var" = API_UPSTREAM ] && origin=http://api:3000
    for shape in newline trailing-newline carriage-return; do
      case "$shape" in
        newline) value="$origin$nl$injected" ;;
        trailing-newline) value="$origin$nl" ;;
        carriage-return) value="$origin$cr$injected" ;;
      esac
      code=0
      docker run --rm --read-only --tmpfs /tmp -e "$var=$value" "$WEB_IMAGE" > "$TMP/refusal.log" 2>&1 || code=$?
      check "$var with a $shape stops the container" test "$code" -ne 0
      check "$var with a $shape is refused as multi-line" grep -q "$var must be a single line" "$TMP/refusal.log"
      check "the $var $shape refusal does not echo the value" sh -c '! grep -q injected "$1"' _ "$TMP/refusal.log"
    done
  done
}

case "$TARGET" in
  api) smoke_api ;;
  web) smoke_web ;;
  all) smoke_web; smoke_api ;;
esac

echo
if [ "$FAILED" -gt 0 ]; then
  echo "image smoke: $FAILED check(s) failed" >&2
  exit 1
fi
echo "image smoke: all checks passed"
