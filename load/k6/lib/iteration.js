// Shared per-iteration logic for the mixed-workload scenarios.
//
// k6 gives each VU its own JS runtime, so module-level state (loggedIn) is
// per-VU. We authenticate once on the VU's first iteration, then run a weighted
// read-mix against the template's real procedures:
//   ~60% user.me (authed profile read)
//   ~25% sessions.list (authed session-list read)
//   ~10% ping.ping (public no-auth read, the lightest sample)
//    ~5% auth churn (a fresh Argon2id login, keeping the auth path under load)
//
// This is a READ-only mixed profile on purpose: the template's only seeded data
// is the user account itself, and a read mix exercises the load-bearing path
// (CSRF + session cookie + the authed tRPC surface) without writing state that
// would need cleanup. A product fork adds its own write profiles here.
//
// __VU is the per-instance VU number (used for the optional per-VU XFF
// throttler bypass); __ITER is this VU's iteration counter.

import { sleep } from 'k6';
import { query } from './trpc.js';
import { login } from './auth.js';
import { vuHeaders, randomIntBetween } from './config.js';

// Shared base options for every mixed-workload scenario.
//
// noCookiesReset is REQUIRED: k6 clears each VU's cookie jar between iterations
// by default, which would wipe the session_id set during the login iteration
// before the read iterations run. Keeping cookies models a real client (log in
// once, reuse the session) and is what makes the login-on-first-iteration
// pattern below work.
export const baseOptions = {
  noCookiesReset: true,
};

let loggedIn = false;

export function mixedIteration() {
  const vu = __VU;
  const headers = vuHeaders(vu);

  if (!loggedIn) {
    loggedIn = login(headers, vu) !== null;
    // Stagger the post-login start a touch so a ramp doesn't fire every VU's
    // first real request on the same tick.
    sleep(randomIntBetween(1, 2));
    return;
  }

  const r = randomIntBetween(1, 100);
  if (r <= 60) {
    query('user.me', undefined, { headers });
  } else if (r <= 85) {
    query('sessions.list', undefined, { headers });
  } else if (r <= 95) {
    // ping.ping declares an input schema (z.object); a single-entry batch GET
    // must send an object, not omit the input param, or tRPC rejects it with a
    // 400 "expected object, received undefined". message is optional, so {}.
    query('ping.ping', {}, { headers });
  } else {
    // Auth churn: a fresh login (Argon2id hash) to keep the auth path under
    // continuous load alongside the reads.
    login(headers, vu);
  }

  sleep(randomIntBetween(1, 3));
}
