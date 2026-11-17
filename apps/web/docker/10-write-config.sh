#!/bin/sh
# Runs at container start (nginx's /docker-entrypoint.d), before nginx. Turns the
# container's environment into two files under /tmp/web, which is the only place
# this image writes (a read-only root filesystem plus a tmpfs on /tmp is fine):
#
#   config.js     window.__APP_CONFIG__ = {...}, served at /config.js and read by
#                 src/lib/env.ts. Keys: API_URL, TURNSTILE_SITE_KEY, SENTRY_DSN,
#                 APP_NAME.
#   runtime.conf  nginx directives included by nginx.conf: the extra CSP source for
#                 API_URL and, when API_UPSTREAM is set, the /trpc and /api proxy.
#
# Values never reach a script as text. Every byte of a value is percent-encoded
# and decoded in the browser with decodeURIComponent, so no quote, backslash,
# `</script>`, newline or Unicode line separator can break out of the string
# literal, whatever the value holds (and non-ASCII text survives intact).
#
# API_URL and API_UPSTREAM also land in nginx directives, so they are validated
# against a strict origin pattern and refused otherwise. A value holding a
# newline or carriage return is refused first: grep matches line by line, so one
# valid line would carry the rest of the value (more nginx directives) past the
# pattern. The refusal message is fixed: it never echoes the value.
set -eu

OUT=/tmp/web
mkdir -p "$OUT"

fail() {
  echo "[web-config] $1" >&2
  exit 1
}

# Percent-encode every byte of $1 (empty in, empty out).
encode() {
  printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n' | sed 's/../%&/g'
}

# `"KEY": decodeURIComponent("...")` for one config key.
pair() {
  printf '  "%s": decodeURIComponent("%s")' "$1" "$(encode "$2")"
}

ORIGIN_PATTERN='^https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?$'

# A literal newline (not $(printf '\n'): command substitution strips trailing
# newlines, which would leave this empty) and a carriage return.
NL='
'
CR=$(printf '\r')

# Refuses $2 (named $1) unless it is one line matching ORIGIN_PATTERN.
require_origin() {
  case "$2" in
    *"$NL"* | *"$CR"*) fail "$1 must be a single line; refusing to start" ;;
  esac
  printf '%s' "$2" | grep -Eq "$ORIGIN_PATTERN" || fail "$1 $3; refusing to start"
}

API_URL="${API_URL:-}"
API_UPSTREAM="${API_UPSTREAM:-}"

if [ -n "$API_URL" ]; then
  require_origin API_URL "$API_URL" \
    "must be an origin such as https://api.example.com (scheme, host, optional port, no path)"
fi
if [ -n "$API_UPSTREAM" ]; then
  require_origin API_UPSTREAM "$API_UPSTREAM" \
    "must be an origin such as http://api:3000 (scheme, host, optional port, no path)"
fi

{
  echo "window.__APP_CONFIG__ = {"
  pair API_URL "$API_URL"; echo ","
  pair TURNSTILE_SITE_KEY "${TURNSTILE_SITE_KEY:-}"; echo ","
  pair SENTRY_DSN "${SENTRY_DSN:-}"; echo ","
  pair APP_NAME "${APP_NAME:-}"; echo
  echo "};"
} > "$OUT/config.js.tmp"
mv "$OUT/config.js.tmp" "$OUT/config.js"

{
  # The CSP's connect-src gains the api origin when it differs from the web's own.
  echo "set \$csp_api \"${API_URL}\";"
  if [ -n "$API_UPSTREAM" ]; then
    # Same-origin proxy: the browser talks to this server and it forwards to the api,
    # so cookies and the CSRF Origin check need no cross-origin setup.
    cat <<CONF
location /trpc {
    include /etc/nginx/snippets/security-headers.conf;
    proxy_pass ${API_UPSTREAM};
    include /etc/nginx/snippets/proxy.conf;
}
location /api/ {
    include /etc/nginx/snippets/security-headers.conf;
    proxy_pass ${API_UPSTREAM};
    include /etc/nginx/snippets/proxy.conf;
}
CONF
  fi
} > "$OUT/runtime.conf.tmp"
mv "$OUT/runtime.conf.tmp" "$OUT/runtime.conf"

echo "[web-config] wrote $OUT/config.js and $OUT/runtime.conf"
