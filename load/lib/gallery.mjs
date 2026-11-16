// Builds load/reports/index.html, a gallery of every load run, reading the
// *.summary.json files written by k6's handleSummary (load/k6/lib/summary.js).
// Each card links to that run's full interactive k6 web-dashboard HTML report.
// Pure Node, no dependencies.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** @returns {Array<object>} parsed summaries, newest first */
export function loadSummaries(reportDir) {
  if (!existsSync(reportDir)) return [];
  return readdirSync(reportDir)
    .filter((f) => f.endsWith('.summary.json'))
    .map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(reportDir, f), 'utf8'));
        data._htmlReport = existsSync(join(reportDir, `${data.runId}.html`))
          ? `${data.runId}.html`
          : null;
        return data;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const ms = (v) => (v == null ? '-' : `${Number(v).toFixed(0)} ms`);
const pct = (v) => (v == null ? '-' : `${(Number(v) * 100).toFixed(2)}%`);
const num = (v) =>
  v == null ? '-' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });

function card(s) {
  const pass = s.passed;
  const badge = pass ? 'pass' : 'fail';
  const when = new Date(s.timestamp).toLocaleString();
  const reportLink = s._htmlReport
    ? `<a class="open" href="${esc(s._htmlReport)}">Open full report</a>`
    : `<span class="open muted">no html report (k6 &lt; 0.49?)</span>`;
  const errClass = (s.errorRate ?? 0) > 0.05 ? 'bad' : 'ok';
  return `
    <article class="card ${badge}">
      <header>
        <span class="scenario">${esc(s.scenario)}</span>
        <span class="pill ${badge}">${pass ? 'PASS' : 'FAIL'}</span>
      </header>
      <time>${esc(when)}</time>
      <div class="metrics">
        <div class="metric"><span class="k">VUs</span><span class="v">${num(s.vusMax)}</span></div>
        <div class="metric"><span class="k">Req/s</span><span class="v">${num(s.rps)}</span></div>
        <div class="metric"><span class="k">p95</span><span class="v">${ms(s.latencyMs?.p95)}</span></div>
        <div class="metric"><span class="k">p99</span><span class="v">${ms(s.latencyMs?.p99)}</span></div>
        <div class="metric"><span class="k">Errors</span><span class="v ${errClass}">${pct(s.errorRate)}</span></div>
        <div class="metric"><span class="k">Requests</span><span class="v">${num(s.httpReqs)}</span></div>
      </div>
      <footer>${reportLink}</footer>
    </article>`;
}

export function renderGallery(summaries) {
  const cards = summaries.length
    ? summaries.map(card).join('\n')
    : `<p class="empty">No load runs yet. Run <code>pnpm load smoke</code> to generate your first report.</p>`;
  const latest = summaries[0];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>load test reports</title>
<style>
  :root {
    --bg: #14121c; --bg2: #1b1828; --card: #221f31; --line: #322d45;
    --ink: #ece9f5; --muted: #948caa; --accent: #b39ddb; --accent2: #7e6bb0;
    --ok: #8bd4a4; --bad: #f0928a; --radius: 16px;
    font-synthesis: none;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: radial-gradient(1200px 600px at 80% -10%, #2a2440 0%, var(--bg) 60%);
    color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 48px 24px 80px; }
  header.hero { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
  h1 { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; margin: 0; }
  h1 .dot { color: var(--accent); }
  .sub { color: var(--muted); margin: 6px 0 32px; font-size: 14px; }
  .latest { background: linear-gradient(135deg, var(--accent2), #5b4d82); border-radius: var(--radius);
    padding: 4px 12px; font-size: 13px; color: #fff; align-self: center; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 18px 18px 14px; transition: transform .15s ease, border-color .15s ease; }
  .card:hover { transform: translateY(-2px); border-color: var(--accent2); }
  .card.fail { border-color: #5c3636; }
  .card header { display: flex; align-items: center; justify-content: space-between; border: 0; padding: 0; margin: 0; }
  .scenario { font-weight: 600; font-size: 16px; text-transform: capitalize; }
  .pill { font-size: 11px; font-weight: 700; letter-spacing: .06em; padding: 3px 9px; border-radius: 999px; }
  .pill.pass { background: rgba(139,212,164,.16); color: var(--ok); }
  .pill.fail { background: rgba(240,146,138,.16); color: var(--bad); }
  time { display: block; color: var(--muted); font-size: 12px; margin: 6px 0 14px; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 8px; }
  .metric { background: var(--bg2); border-radius: 10px; padding: 8px 10px; }
  .metric .k { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .metric .v { display: block; font-size: 16px; font-weight: 600; margin-top: 2px; }
  .metric .v.ok { color: var(--ok); } .metric .v.bad { color: var(--bad); }
  footer { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .open { color: var(--accent); text-decoration: none; font-size: 13px; font-weight: 600; }
  .open:hover { text-decoration: underline; }
  .open.muted { color: var(--muted); font-weight: 400; }
  .empty { color: var(--muted); }
  code { background: var(--bg2); padding: 2px 6px; border-radius: 6px; font-size: 13px; }
  .foot { color: var(--muted); font-size: 12px; margin-top: 40px; }
  .foot a { color: var(--accent); }
</style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div>
        <h1>load test reports</h1>
      </div>
      ${latest ? `<span class="latest">latest: ${esc(latest.scenario)} · ${esc(new Date(latest.timestamp).toLocaleString())}</span>` : ''}
    </header>
    <p class="sub">Generated by <code>pnpm load</code>. Each card links to k6's interactive web-dashboard report.</p>
    <div class="grid">
      ${cards}
    </div>
    <p class="foot">Read per-procedure latency/throughput from <code>trpc_procedure_duration_seconds</code> in your metrics backend: a tRPC batch is one HTTP request, so k6's HTTP counter is not per-procedure. See <code>load/README.md</code>.</p>
  </div>
</body>
</html>`;
}

/** Scan reportDir, render index.html, return the number of runs indexed. */
export function buildGallery(reportDir) {
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const summaries = loadSummaries(reportDir);
  writeFileSync(join(reportDir, 'index.html'), renderGallery(summaries), 'utf8');
  return summaries.length;
}
