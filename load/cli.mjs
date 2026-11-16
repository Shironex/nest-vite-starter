#!/usr/bin/env node
// Load-test CLI, one command to run a k6 scenario and get a report.
//
//   pnpm load <scenario> [flags]
//   scenarios: smoke (default) · baseline · stress · spike · soak
//
// Flags:
//   --url=<url>        target API (default http://localhost:3000)
//   --users=<n>        size of the load-test user pool (pool scenarios; auto-seeded)
//   --no-seed          skip the (pool) seed; assume the accounts already exist
//   --seed             (smoke) seed the admin user via db:seed before running
//   --prometheus       stream k6 metrics into a Prometheus (remote-write)
//   --xff              per-VU X-Forwarded-For throttler bypass (host-native + loopback only)
//   --docker           force the grafana/k6 Docker image instead of a host k6 binary
//   --no-dashboard     skip the k6 web-dashboard HTML export
//   --skip-preflight   don't check /health before running
//
// Credentials come from the repo-root .env (auto-loaded below), so a plain
// `node load/cli.mjs smoke` logs in as the seeded admin without any manual
// export. Single-user mode (the default) uses ADMIN_EMAIL / ADMIN_PASSWORD.
// For heavy scenarios pass --users=N: the CLI auto-seeds N disposable accounts
// (load-user-0..N-1@example.test) via db:seed:load and k6 round-robins VUs
// across them to stay under the 3-session cap; or use --xff host-native.
//
// Detects a host `k6` binary; falls back to the grafana/k6 Docker image
// (rewriting localhost -> host.docker.internal). Always writes a summary JSON +
// rebuilds load/reports/index.html. Exit code mirrors k6's threshold result.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGallery, loadSummaries } from './lib/gallery.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Load the repo-root .env into process.env so a plain `node load/cli.mjs smoke`
// (no manual `export`) logs in with the SAME credentials the seed wrote. Without
// this the harness fell back to config.js' placeholder password, every login
// 401'd, the account locked, the per-IP auth window burned, and smoke reported
// ~49% errors / ~34% checks (all failures on auth.login). Zero-dependency parse
// (the harness must run offline); shell-exported vars WIN over the file so an
// explicit `ADMIN_PASSWORD=… node load/cli.mjs` still overrides. Only KEY=VALUE
// lines, optional surrounding quotes stripped, values may contain `=`/spaces.
function loadRootEnv() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue; // shell export wins
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadRootEnv();

const REPORT_DIR_REL = 'load/reports';
const REPORT_DIR_ABS = join(REPO_ROOT, REPORT_DIR_REL);
const SCENARIOS = ['smoke', 'baseline', 'stress', 'spike', 'soak'];
// Peak VUs each scenario reaches, used to size the user pool so VUs spread
// across distinct accounts (the app caps a user at 3 concurrent sessions).
const SCENARIO_MAX_VUS = { smoke: 1, baseline: 10, stress: 200, spike: 100, soak: 50 };

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  violet: (s) => `\x1b[35m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const args = { scenario: 'smoke', flags: {} };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args.flags[k] = v === undefined ? true : v;
    } else if (SCENARIOS.includes(a)) {
      args.scenario = a;
    } else {
      console.error(c.red(`Unknown scenario "${a}". Valid: ${SCENARIOS.join(', ')}`));
      process.exit(2);
    }
  }
  return args;
}

function have(cmd, probeArgs) {
  const r = spawnSync(cmd, probeArgs, { stdio: 'ignore' });
  return r.status === 0;
}

async function preflight(url) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function main() {
  const { scenario, flags } = parseArgs(process.argv.slice(2));
  const url = (flags.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const runId = `${scenario}-${timestamp()}`;
  const scenarioFile = `load/k6/scenarios/${scenario}.js`;

  console.log(c.violet(c.bold('\n  load test')));
  console.log(`  scenario : ${c.bold(scenario)}`);
  console.log(`  target   : ${url}`);
  console.log(`  run id   : ${c.dim(runId)}\n`);

  if (!existsSync(REPORT_DIR_ABS)) mkdirSync(REPORT_DIR_ABS, { recursive: true });

  // Size the user pool. smoke (1 VU) uses the single seeded admin. Every other
  // scenario defaults to ONE account per peak VU: the app caps a user at
  // MAX_SESSIONS=3 (session.service.ts), and the ~5% auth-churn re-login means
  // even 2 VUs/account eventually push a shared account past 3 sessions and
  // evict a live peer's session (its reads then 401). 1 VU/account removes that:
  // a churn login only ever evicts the VU's OWN stale session. Override the
  // count with --users=N; pass --no-seed to skip the seed.
  const maxVus = SCENARIO_MAX_VUS[scenario] ?? 10;
  let poolSize = 0;
  if (scenario !== 'smoke') {
    if (flags.users !== undefined) {
      // `--users` with no value parses as `true`; a typo parses as NaN. Reject
      // anything that isn't a positive integer rather than seeding "NaN" users.
      const parsedUsers = Number.parseInt(String(flags.users), 10);
      if (!Number.isInteger(parsedUsers) || parsedUsers < 1) {
        console.error(c.red(`  invalid --users "${flags.users}", use a positive integer.`));
        process.exit(2);
      }
      poolSize = parsedUsers;
    } else {
      poolSize = maxVus; // one account per peak VU
    }
  }

  if (poolSize > 0) {
    console.log(`  user pool : ${poolSize} accounts (${maxVus} max VUs)`);
    if (!flags.xff) {
      // The pool spreads the MAX_SESSIONS cap; it does NOT spread the per-IP
      // auth rate limit (10 logins/60s/IP, auth-shared.service.ts), which all
      // VUs share from one host. --xff gives each VU its own IP bucket
      // (trust proxy = loopback honors X-Forwarded-For host-native).
      console.log(
        c.yellow(
          '  note: add --xff host-native so each VU gets its own per-IP auth\n' +
            '        rate-limit bucket (10 logins/60s/IP). Required to stay green at >~5 VUs.\n',
        ),
      );
    } else {
      console.log('');
    }
  }

  ensureSeeded({ scenario, poolSize, flags });

  // Preflight + k6 run happen in run() (async).
  run({ scenario, scenarioFile, url, runId, flags, poolSize });
}

// Seeding before a run so the accounts a VU logs in as actually exist.
//   • Pool scenario (--users=N): auto-seed N disposable load-user-*@example.test
//     accounts via db:seed:load (idempotent: re-runs reset each user's lockout
//     so a poisoned prior run can't keep the pool red). Skip with --no-seed.
//   • smoke --seed: seed the single admin (ADMIN_EMAIL / ADMIN_PASSWORD).
// Both inherit creds from the repo-root .env loaded at startup, so a plain
// invocation works without exporting anything.
function ensureSeeded({ scenario, poolSize, flags }) {
  if (flags['no-seed']) return;
  if (poolSize > 0) {
    console.log(
      c.dim(`  seeding ${poolSize}-user pool (db:seed:load; idempotent, --no-seed to skip)...`),
    );
    const r = spawnSync('pnpm', ['--filter', '@repo/database', 'db:seed:load'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, LOAD_USERS: String(poolSize) },
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
      console.error(c.red('  seed failed, aborting.'));
      process.exit(1);
    }
    return;
  }
  maybeSeed({ scenario, flags });
}

// smoke --seed runs the template's admin seed (ADMIN_EMAIL / ADMIN_PASSWORD).
function maybeSeed({ scenario, flags }) {
  if (scenario === 'smoke' && flags.seed) {
    console.log(c.dim('  seeding admin user (db:seed)...'));
    const r = spawnSync('pnpm', ['--filter', '@repo/database', 'db:seed'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env },
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
      console.error(c.red('  seed failed, aborting.'));
      process.exit(1);
    }
  }
}

async function run({ scenario, scenarioFile, url, runId, flags, poolSize }) {
  if (!flags['skip-preflight']) {
    const reachable = await preflight(url);
    if (!reachable) {
      console.error(c.red(`  x API /health not reachable at ${url}`));
      console.error(c.dim('    Start the stack first:'));
      console.error(c.dim('      docker compose up -d            # postgres + redis + mailpit'));
      console.error(c.dim('      pnpm --filter @repo/database db:migrate:deploy'));
      console.error(c.dim('      UV_THREADPOOL_SIZE=16 pnpm --filter @repo/api dev'));
      console.error(c.dim('    ...or pass --skip-preflight to run anyway.'));
      process.exit(1);
    }
    console.log(c.green('  ok API reachable\n'));
  }

  const useDocker = flags.docker || !have('k6', ['version']);
  if (useDocker && !have('docker', ['version'])) {
    console.error(c.red('  x Neither a host `k6` binary nor Docker is available.'));
    console.error(
      c.dim('    Install k6:  macOS `brew install k6`  ·  Windows `winget install k6.k6`'),
    );
    console.error(c.dim('    or start Docker Desktop to use the grafana/k6 image.'));
    process.exit(1);
  }

  const dashboardHtml = `${REPORT_DIR_REL}/${runId}.html`;
  const wantDashboard = !flags['no-dashboard'];
  const wantProm = !!flags.prometheus;

  // Forward the seeded admin creds to k6 so single-user login works without
  // re-specifying them (config.js reads LOAD_USER_* then ADMIN_*).
  const credEnv = {
    ...(process.env.ADMIN_EMAIL ? { ADMIN_EMAIL: process.env.ADMIN_EMAIL } : {}),
    ...(process.env.ADMIN_PASSWORD ? { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD } : {}),
    ...(process.env.LOAD_USER_EMAIL ? { LOAD_USER_EMAIL: process.env.LOAD_USER_EMAIL } : {}),
    ...(process.env.LOAD_USER_PASSWORD
      ? { LOAD_USER_PASSWORD: process.env.LOAD_USER_PASSWORD }
      : {}),
  };

  let cmd, cmdArgs, env;
  if (useDocker) {
    console.log(c.yellow('  using grafana/k6 Docker image'));
    if (flags.xff)
      console.log(
        c.yellow(
          '  note: --xff has no effect from Docker (source IP != loopback); raise the throttler limit instead.',
        ),
      );
    const dockerUrl = url.replace(/(localhost|127\.0\.0\.1)/, 'host.docker.internal');
    const promUrl =
      process.env.K6_PROMETHEUS_RW_SERVER_URL || 'http://host.docker.internal:9090/api/v1/write';
    cmd = 'docker';
    cmdArgs = [
      'run',
      '--rm',
      '-i',
      '--add-host=host.docker.internal:host-gateway',
      '-v',
      `${REPO_ROOT}:/work`,
      '-w',
      '/work',
      '-e',
      `BASE_URL=${dockerUrl}`,
      '-e',
      `RUN_ID=${runId}`,
      '-e',
      `REPORT_DIR=${REPORT_DIR_REL}`,
      '-e',
      `SCENARIO=${scenario}`,
      '-e',
      `USE_XFF=${flags.xff ? 'true' : 'false'}`,
      ...(poolSize > 0 ? ['-e', `LOAD_USERS=${poolSize}`] : []),
      ...Object.entries(credEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      ...(wantDashboard
        ? ['-e', 'K6_WEB_DASHBOARD=true', '-e', `K6_WEB_DASHBOARD_EXPORT=${dashboardHtml}`]
        : []),
      ...(wantProm ? ['-e', `K6_PROMETHEUS_RW_SERVER_URL=${promUrl}`] : []),
      'grafana/k6',
      'run',
      ...(wantProm ? ['--out', 'experimental-prometheus-rw'] : []),
      scenarioFile,
    ];
    env = process.env;
  } else {
    cmd = 'k6';
    cmdArgs = ['run', ...(wantProm ? ['--out', 'experimental-prometheus-rw'] : []), scenarioFile];
    env = {
      ...process.env,
      ...credEnv,
      BASE_URL: url,
      RUN_ID: runId,
      REPORT_DIR: REPORT_DIR_REL,
      SCENARIO: scenario,
      USE_XFF: flags.xff ? 'true' : 'false',
      ...(poolSize > 0 ? { LOAD_USERS: String(poolSize) } : {}),
      ...(wantDashboard
        ? { K6_WEB_DASHBOARD: 'true', K6_WEB_DASHBOARD_EXPORT: dashboardHtml }
        : {}),
      ...(wantProm
        ? {
            K6_PROMETHEUS_RW_SERVER_URL:
              process.env.K6_PROMETHEUS_RW_SERVER_URL || 'http://localhost:9090/api/v1/write',
          }
        : {}),
    };
  }

  console.log(c.dim(`  $ ${cmd} ${cmdArgs.join(' ')}\n`));
  const result = spawnSync(cmd, cmdArgs, { cwd: REPO_ROOT, stdio: 'inherit', env });

  // Rebuild the gallery regardless of pass/fail so failed runs are visible too.
  const indexed = buildGallery(REPORT_DIR_ABS);
  const summaries = loadSummaries(REPORT_DIR_ABS);
  const mine = summaries.find((s) => s.runId === runId);

  console.log('');
  if (mine) {
    console.log(`  report   : ${c.violet(join(REPORT_DIR_REL, `${runId}.html`))}`);
  }
  console.log(
    `  gallery  : ${c.violet(join(REPORT_DIR_REL, 'index.html'))} ${c.dim(`(${indexed} run${indexed === 1 ? '' : 's'})`)}`,
  );

  const passed = result.status === 0;
  console.log(
    passed
      ? c.green('\n  ok thresholds passed\n')
      : c.red(`\n  x k6 exited ${result.status} (threshold breach or error)\n`),
  );
  process.exit(result.status ?? 1);
}

main();
