// Shared configuration + small helpers for every k6 scenario.
//
// Everything is driven by environment variables so the same scripts run
// host-native (the default, against http://localhost:3000) or inside the
// grafana/k6 Docker image (BASE_URL rewritten to host.docker.internal by the
// CLI). No remote (jslib) imports anywhere in this harness, it must run
// offline and be version-proof.

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

// nestjs-trpc mounts the router at /trpc (the REST routes carry the /api prefix
// in their own paths; there is no global prefix). The CSRF token endpoint is a
// plain REST route at /api/csrf-token. Overridable in case a reverse proxy
// remaps the mount.
export const TRPC_BASE = (__ENV.TRPC_BASE || '/trpc').replace(/\/+$/, '');

// User selection. The app caps each user at MAX_SESSIONS=3 concurrent sessions
// (session.service.ts), so many VUs on one account would evict each other and
// 401. Two modes:
//   - Single-user (LOAD_USERS=0, default): every VU logs in as one seeded user.
//     Fine for smoke / <=3 VUs.
//   - Pool (LOAD_USERS=N): VU k logs in as load-user-(k-1 mod N)@example.test,
//     spreading load across distinct accounts. The template has NO pool-seed
//     script, so you must seed those accounts yourself first (see load/README.md).
//
// The single-user credentials default to the admin the template seed creates
// from ADMIN_EMAIL / ADMIN_PASSWORD (`pnpm --filter @repo/database db:seed`).
// Override with LOAD_USER_EMAIL / LOAD_USER_PASSWORD.
export const SINGLE_EMAIL = __ENV.LOAD_USER_EMAIL || __ENV.ADMIN_EMAIL || 'admin@example.com';
export const SINGLE_PASSWORD =
  __ENV.LOAD_USER_PASSWORD || __ENV.ADMIN_PASSWORD || 'change-me-admin-password';
// Coerce to a non-negative integer, a fractional env value would otherwise
// produce ids like `load-user-0.5@...` via the modulo in credsForVu and fail login.
const parsedLoadUsers = parseInt(__ENV.LOAD_USERS || '0', 10);
export const LOAD_USERS = Number.isInteger(parsedLoadUsers) ? Math.max(0, parsedLoadUsers) : 0;
export const POOL_PASSWORD = __ENV.LOAD_USER_PASSWORD || 'load-test-password';

/** Credentials for a given VU id (1-based). */
export function credsForVu(vu) {
  if (LOAD_USERS > 0) {
    return { email: `load-user-${(vu - 1) % LOAD_USERS}@example.test`, password: POOL_PASSWORD };
  }
  return { email: SINGLE_EMAIL, password: SINGLE_PASSWORD };
}

// Cloudflare Turnstile: in dev the test secret key
// (1x0000000000000000000000000000000AA) returns success for ANY token, so a
// non-empty placeholder satisfies the required `turnstileToken` field.
export const TURNSTILE_TOKEN = __ENV.LOAD_TURNSTILE_TOKEN || 'XXXX.DUMMY.LOADTEST.TOKEN.XXXX';

// Per-VU X-Forwarded-For throttler-bypass (DEV ONLY). `trust proxy = loopback`
// (apps/api/src/main.ts) means Express honors XFF only from loopback, so this
// works host-native against localhost, each VU gets a distinct rate-limit
// bucket. It does NOT work from inside Docker (source IP is a Docker-network
// address). The template's throttler limit is hard-coded at 100 req/60s
// (app.module.ts), so for heavy scenarios use this XFF bypass host-native, or
// temporarily raise the limit in code. Off by default.
export const USE_XFF = (__ENV.USE_XFF || 'false') === 'true';

// tiny helpers (no jslib)
export function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Per-VU source IP so each virtual user maps to its own throttler bucket.
// 10.x.x.x is RFC1918; spread across the space to avoid collisions at scale.
export function vuHeaders(vu) {
  if (!USE_XFF) return {};
  const a = (vu >> 8) & 0xff;
  const b = vu & 0xff;
  return { 'X-Forwarded-For': `10.0.${a}.${b}` };
}
