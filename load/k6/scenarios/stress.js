// Stress, ramp 0 to 200 VUs over ~5 min. Finds the knee: the p95 inflection
// and the concurrency at which 500s first appear. Expect the Argon2id login
// ceiling on the auth slice (lift with UV_THREADPOOL_SIZE) and the
// DB_POOL_MAX=10 ceiling on the read slice (fast 500s, not hangs). Thresholds
// are intentionally loose so the run completes and reports rather than aborting.
//
// NOTE: 200 VUs on one account hits the MAX_SESSIONS=3 cap and the 100/60s
// throttler. Seed a user pool and pass --users=N, or use --xff host-native, so
// the run measures the API rather than the session cap / rate limit. See
// load/README.md.
import { mixedIteration, baseOptions } from '../lib/iteration.js';

export { handleSummary } from '../lib/summary.js';

export const options = {
  ...baseOptions,
  stages: [
    { duration: '1m', target: 50 },
    { duration: '2m', target: 120 },
    { duration: '2m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Diagnostic, not gating, we WANT to push past these to find the wall.
    http_req_failed: ['rate<0.25'],
    http_req_duration: ['p(95)<3000'],
  },
};

export default function () {
  mixedIteration();
}
