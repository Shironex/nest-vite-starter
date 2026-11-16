// Authentication flow for k6 VUs.
//
// 1. GET /api/csrf-token  -> { csrfToken }, and sets csrf-sid / csrf-token
//    cookies in the per-VU jar (apps/api/src/main.ts).
// 2. POST <TRPC_BASE>/auth.login with header x-csrf-token -> sets the
//    session_id cookie (jar carries it on every subsequent request).
// 3. login ROTATES the CSRF token, so callers re-fetch a fresh token after
//    login before any mutation (apps/api/src/common/security/csrf.service.ts).

import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, TRPC_BASE, credsForVu, TURNSTILE_TOKEN } from './config.js';

/** Fetch a fresh CSRF token (also refreshes the jar's csrf cookies). */
export function csrfToken(headers = {}) {
  const res = http.get(`${BASE_URL}/api/csrf-token`, {
    headers,
    tags: { procedure: 'csrf-token' },
  });
  check(res, { 'csrf-token 200': (r) => r.status === 200 });
  if (res.status !== 200) return null;
  try {
    const token = res.json('csrfToken');
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Authenticate the given VU (1-based id). Returns a CSRF token valid for
 * subsequent mutations, or null on failure. `headers` lets the per-VU XFF
 * header ride along so the whole auth handshake shares the VU's throttler
 * bucket. `vu` selects the account from the user pool (see credsForVu).
 */
export function login(headers = {}, vu = __VU) {
  const { email, password } = credsForVu(vu);
  const token = csrfToken(headers);
  if (!token) return null;
  const body = JSON.stringify({
    0: { json: { email, password, rememberMe: true, turnstileToken: TURNSTILE_TOKEN } },
  });
  const res = http.post(`${BASE_URL}${TRPC_BASE}/auth.login?batch=1`, body, {
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': token, ...headers },
    tags: { procedure: 'auth.login', type: 'mutation' },
  });
  const ok = check(res, {
    'login 200': (r) => r.status === 200,
    'login set session': (r) => {
      const entry = (() => {
        try {
          return r.json()[0];
        } catch {
          return null;
        }
      })();
      return !!entry && !entry.error;
    },
  });
  if (!ok) return null;
  // CSRF token rotated on login, hand back a fresh one for mutations.
  return csrfToken(headers);
}
