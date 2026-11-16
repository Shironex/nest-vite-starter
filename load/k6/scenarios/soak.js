// Soak, 50 VUs held for 30 min. Surfaces slow drift invisible in short runs:
// memory growth, connection leaks, queue-depth creep. Watch your metrics
// dashboards over the full window, not just the k6 summary. Override the hold
// duration with -e SOAK_DURATION=10m for a shorter run.
//
// NOTE: 50 VUs on one account hits the MAX_SESSIONS=3 cap. Seed a user pool and
// pass --users=N, or use --xff host-native. See load/README.md.
import { mixedIteration, baseOptions } from '../lib/iteration.js';

export { handleSummary } from '../lib/summary.js';

const HOLD = __ENV.SOAK_DURATION || '30m';

export const options = {
  ...baseOptions,
  stages: [
    { duration: '1m', target: 50 },
    { duration: HOLD, target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1000'],
    checks: ['rate>0.95'],
  },
};

export default function () {
  mixedIteration();
}
