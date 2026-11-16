// Self-contained handleSummary, no jslib/remote imports.
//
// Writes a compact machine-readable summary JSON (consumed by the CLI to build
// the report gallery) plus the full raw k6 summary, and prints a short text
// summary to stdout. The rich interactive HTML report is produced separately
// by k6's built-in web dashboard (K6_WEB_DASHBOARD_EXPORT, set by the CLI),
// this module owns the structured data the gallery indexes.
//
// __ENV.REPORT_DIR  - directory for outputs (default: load/reports)
// __ENV.RUN_ID      - basename for this run (default: run-<timestamp>)
// __ENV.SCENARIO    - scenario label recorded in the summary

const REPORT_DIR = __ENV.REPORT_DIR || 'load/reports';
const RUN_ID = __ENV.RUN_ID || `run-${Date.now()}`;
const SCENARIO = __ENV.SCENARIO || 'unknown';

function metricValue(data, name, field) {
  const m = data.metrics[name];
  if (!m || !m.values) return null;
  return m.values[field] != null ? m.values[field] : null;
}

function thresholdsPassed(data) {
  let failed = 0;
  let total = 0;
  for (const name of Object.keys(data.metrics)) {
    const m = data.metrics[name];
    if (!m.thresholds) continue;
    for (const t of Object.keys(m.thresholds)) {
      total += 1;
      if (m.thresholds[t].ok === false) failed += 1;
    }
  }
  return { failed, total, passed: failed === 0 };
}

export function handleSummary(data) {
  const checks = data.metrics.checks ? data.metrics.checks.values : {};
  const th = thresholdsPassed(data);

  const compact = {
    runId: RUN_ID,
    scenario: SCENARIO,
    timestamp: new Date().toISOString(),
    durationMs: data.state ? data.state.testRunDurationMs : null,
    vusMax: metricValue(data, 'vus_max', 'max'),
    iterations: metricValue(data, 'iterations', 'count'),
    rps: metricValue(data, 'http_reqs', 'rate'),
    httpReqs: metricValue(data, 'http_reqs', 'count'),
    latencyMs: {
      avg: metricValue(data, 'http_req_duration', 'avg'),
      p90: metricValue(data, 'http_req_duration', 'p(90)'),
      p95: metricValue(data, 'http_req_duration', 'p(95)'),
      p99: metricValue(data, 'http_req_duration', 'p(99)'),
      max: metricValue(data, 'http_req_duration', 'max'),
    },
    errorRate: metricValue(data, 'http_req_failed', 'rate'),
    checks: {
      passes: checks.passes != null ? checks.passes : null,
      fails: checks.fails != null ? checks.fails : null,
      rate: checks.rate != null ? checks.rate : null,
    },
    thresholds: th,
    // Pass/fail follows the scenario's thresholds (k6's authoritative gate +
    // exit code), not a zero-check-fails rule, because stress/spike scenarios
    // deliberately tolerate a small error rate while finding the ceiling.
    passed: th.passed,
  };

  const line = (label, value) => `  ${label.padEnd(22)} ${value}`;
  const ms = (v) => (v == null ? 'n/a' : `${v.toFixed(1)}ms`);
  const stdout = [
    '',
    `=== load test, ${SCENARIO} ===`,
    line('VUs (max)', compact.vusMax ?? 'n/a'),
    line(
      'Requests',
      `${compact.httpReqs ?? 'n/a'} (${compact.rps ? compact.rps.toFixed(1) : 'n/a'}/s)`,
    ),
    line('Latency p95', ms(compact.latencyMs.p95)),
    line('Latency p99', ms(compact.latencyMs.p99)),
    line(
      'Error rate',
      compact.errorRate != null ? `${(compact.errorRate * 100).toFixed(2)}%` : 'n/a',
    ),
    line(
      'Checks',
      compact.checks.rate != null ? `${(compact.checks.rate * 100).toFixed(1)}% passed` : 'n/a',
    ),
    line(
      'Thresholds',
      compact.thresholds.passed
        ? 'all passed'
        : `${compact.thresholds.failed}/${compact.thresholds.total} failed`,
    ),
    line('Result', compact.passed ? 'PASS' : 'FAIL'),
    '',
  ].join('\n');

  const out = {};
  out['stdout'] = stdout;
  out[`${REPORT_DIR}/${RUN_ID}.summary.json`] = JSON.stringify(compact, null, 2);
  out[`${REPORT_DIR}/${RUN_ID}.raw.json`] = JSON.stringify(data);
  return out;
}
