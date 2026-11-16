// tRPC-over-HTTP client for k6.
//
// The web client uses httpBatchLink + superjson (apps/web/src/lib/trpc.ts;
// server transformer at apps/api/src/app.module.ts). We deliberately send ONE
// procedure per HTTP request (a single-entry batch) rather than combining many
// calls into one POST. This keeps clean per-procedure attribution and keeps the
// scripts readable. The wire format is still the batch format the server is
// guaranteed to accept:
//
//   query    GET  <TRPC_BASE>/<path>?batch=1&input=<urlenc {"0":{"json":input}}>
//   mutation POST <TRPC_BASE>/<path>?batch=1   body {"0":{"json":input}}
//
// superjson wraps every value as {"json": value}. Responses come back as
//   [ { "result": { "data": { "json": <output> } } } ]
//
// CSRF: the API uses double-submit CSRF that ignores safe methods, so GET
// queries need no token; POST mutations send `x-csrf-token`. k6's per-VU
// cookie jar carries session_id + csrf cookies automatically.

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, TRPC_BASE } from './config.js';

// Custom per-procedure client-side metrics (complement the server histogram).
const trpcDuration = new Trend('trpc_client_duration_ms', true);
const trpcErrors = new Rate('trpc_client_errors');

function trpcUrl(path, input) {
  let url = `${BASE_URL}${TRPC_BASE}/${path}?batch=1`;
  if (input !== undefined) {
    const payload = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
    url += `&input=${payload}`;
  }
  return url;
}

function unwrap(res, path) {
  let value;
  let ok = res.status === 200;
  try {
    const body = res.json();
    const entry = Array.isArray(body) ? body[0] : body;
    if (entry && entry.error) ok = false;
    value = entry && entry.result && entry.result.data ? entry.result.data.json : undefined;
  } catch {
    ok = false;
  }
  trpcDuration.add(res.timings.duration, { procedure: path });
  trpcErrors.add(!ok, { procedure: path });
  return { ok, value, res };
}

/** GET query. `input` may be undefined for no-input procedures. */
export function query(path, input, params = {}) {
  const res = http.get(trpcUrl(path, input), {
    tags: { procedure: path, type: 'query' },
    headers: { ...(params.headers || {}) },
  });
  const out = unwrap(res, path);
  check(out, { [`query ${path} ok`]: (o) => o.ok });
  return out;
}

/** POST mutation. `csrfToken` is required (state-changing). */
export function mutation(path, input, csrfToken, params = {}) {
  const res = http.post(
    `${BASE_URL}${TRPC_BASE}/${path}?batch=1`,
    JSON.stringify({ 0: { json: input } }),
    {
      tags: { procedure: path, type: 'mutation' },
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken || '',
        ...(params.headers || {}),
      },
    },
  );
  const out = unwrap(res, path);
  check(out, { [`mutation ${path} ok`]: (o) => o.ok });
  return out;
}
