// Smoke, 1 VU, 30s. The "do the scripts even authenticate and hit real
// procedures" check. Run this first, every time, before any heavier scenario.
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { mixedIteration, baseOptions } from '../lib/iteration.js';

export { handleSummary } from '../lib/summary.js';

export const options = {
  ...baseOptions,
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<1500'],
    checks: ['rate>0.90'],
  },
};

export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  check(res, { 'health reachable': (r) => r.status === 200 });
  if (res.status !== 200) {
    throw new Error(
      `API /health not reachable at ${BASE_URL} (status ${res.status}). Is the dev server up?`,
    );
  }
}

export default function () {
  mixedIteration();
}
