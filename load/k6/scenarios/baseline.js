// Baseline, 10 VUs, ~2 min. Records the steady-state "before" numbers every
// future change is measured against. Read per-procedure p95 off the server's
// trpc_procedure_duration_seconds in your metrics backend, NOT k6's HTTP
// counter (a tRPC batch = 1 HTTP request). See load/README.md.
import { mixedIteration, baseOptions } from '../lib/iteration.js';

export { handleSummary } from '../lib/summary.js';

export const options = {
  ...baseOptions,
  stages: [
    { duration: '30s', target: 10 },
    { duration: '60s', target: 10 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.95'],
  },
};

export default function () {
  mixedIteration();
}
