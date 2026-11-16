// Spike, 0 to 100 VUs in 10s, hold 1 min, ramp down. Measures throttler shed +
// recovery and how the API absorbs a sudden burst. Over the rate limit should
// return 429, never 500.
//
// NOTE: a 100-VU burst on one account hits the MAX_SESSIONS=3 cap and the
// 100/60s throttler. Seed a user pool and pass --users=N, or use --xff
// host-native. See load/README.md.
import { mixedIteration, baseOptions } from '../lib/iteration.js';

export { handleSummary } from '../lib/summary.js';

export const options = {
  ...baseOptions,
  stages: [
    { duration: '10s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.30'],
    http_req_duration: ['p(95)<4000'],
  },
};

export default function () {
  mixedIteration();
}
