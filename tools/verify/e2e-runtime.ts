import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import type { ISandboxDescriptor } from './descriptor';
import { laneDatabaseUrl, laneRedisUrl, mailpitHttpUrl, s3Endpoint, smtpPort } from './descriptor';
import { docker } from './docker';
import { E2E_ADMIN, e2eApiEnv } from './e2e-env';
import { childEnv, run, waitFor } from './exec';
import { laneById } from './lanes';
import { freePort } from './ports';
import { createLanes } from './sandbox-lifecycle';

const LANE = laneById('e2e');

export interface IE2eLaneResult {
  readonly status: number;
  readonly junitFile: string;
  readonly apiPort: number;
  readonly webPort: number;
}

interface IChild {
  readonly name: string;
  readonly child: ChildProcess;
}

/*
 * Children are spawned detached, so each gets its own process group, and the
 * teardown signals the GROUP (`kill(-pid)`). `vite preview` and the nest
 * launcher both fork, and killing the direct child alone leaves a listener
 * holding the port, which the next run then either fails on (strictPort) or,
 * worse, silently tests against.
 */
function killGroup(entry: IChild): void {
  const { pid } = entry.child;
  if (pid === undefined || entry.child.exitCode !== null) {
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Already gone: the group leader exited between the check and the signal.
  }
}

async function probe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export interface IE2eLaneOptions {
  readonly root: string;
  readonly descriptor: ISandboxDescriptor;
  /** Extra arguments appended to the Playwright invocation. */
  readonly playwrightArgs?: readonly string[];
  readonly log?: (message: string) => void;
  /** Send Playwright's own output to stderr, so a caller's stdout stays a document. */
  readonly quietStdout?: boolean;
}

export async function runE2eLane(options: IE2eLaneOptions): Promise<IE2eLaneResult> {
  const { root, descriptor } = options;
  const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
  const children: IChild[] = [];

  const teardown = (): void => {
    for (const entry of children.splice(0)) {
      killGroup(entry);
    }
  };
  // Installed BEFORE anything is booted, so a failure between two spawns still
  // reaps the first one.
  process.once('exit', teardown);
  process.once('SIGINT', teardown);
  process.once('SIGTERM', teardown);

  try {
    const databaseUrl = laneDatabaseUrl(descriptor, LANE);
    const redisUrl = laneRedisUrl(descriptor, LANE);

    log('Recreating the e2e database from the migrated template');
    createLanes(descriptor, [LANE.id]);
    const redisContainer = descriptor.services['redis']?.container;
    if (redisContainer !== undefined) {
      docker(['exec', redisContainer, 'redis-cli', '-n', String(LANE.redisDb), 'FLUSHDB']);
    }

    log('Seeding (db:seed, the CI-shaped seed, not db:seed:dev)');
    // NODE_ENV stays unset here on purpose: the seed's production guard must not
    // trip, and its dev/e2e block is what provisions the per-spec fixture users.
    const seed = run('pnpm', ['--filter', '@repo/database', 'db:seed'], {
      cwd: root,
      env: {
        DATABASE_URL: databaseUrl,
        ADMIN_EMAIL: E2E_ADMIN.email,
        ADMIN_PASSWORD: E2E_ADMIN.password,
      },
    });
    if (seed.status !== 0) {
      throw new Error(`db:seed failed:\n${seed.stdout}\n${seed.stderr}`);
    }

    log('Building the api and the web app (absolute base, as CI does)');
    const buildApi = run('pnpm', ['exec', 'turbo', 'build', '--filter=@repo/api'], {
      cwd: root,
      env: { DATABASE_URL: databaseUrl },
    });
    if (buildApi.status !== 0) {
      throw new Error(`api build failed:\n${buildApi.stdout}\n${buildApi.stderr}`);
    }
    const buildWeb = run('pnpm', ['--filter', '@repo/web', 'exec', 'vite', 'build', '--base=/'], {
      cwd: root,
      env: {},
    });
    if (buildWeb.status !== 0) {
      throw new Error(`web build failed:\n${buildWeb.stdout}\n${buildWeb.stderr}`);
    }

    const apiPort = await freePort();
    const webPort = await freePort();

    const apiEnv = e2eApiEnv({
      apiPort,
      webPort,
      databaseUrl,
      redisUrl,
      s3Endpoint: s3Endpoint(descriptor),
      s3Bucket: LANE.bucket,
      smtpHost: '127.0.0.1',
      smtpPort: smtpPort(descriptor),
    });

    log(`Starting the built api on :${apiPort}`);
    const api = spawn('node', [join('apps', 'api', 'dist', 'src', 'main.js')], {
      cwd: root,
      env: childEnv(apiEnv),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push({ name: 'api', child: api });
    let apiOutput = '';
    api.stdout?.on('data', (chunk: Buffer) => {
      apiOutput += chunk.toString();
    });
    api.stderr?.on('data', (chunk: Buffer) => {
      apiOutput += chunk.toString();
    });

    const apiFailure = await waitFor(() => probe(`http://127.0.0.1:${apiPort}/health`), {
      timeoutMs: 90_000,
      intervalMs: 1_000,
      abort: () => (api.exitCode === null ? null : `the api exited with ${String(api.exitCode)}`),
    });
    if (apiFailure !== null) {
      throw new Error(`The api never became ready (${apiFailure}).\n${apiOutput}`);
    }

    // --host 127.0.0.1 rather than vite's default `localhost`: on a machine
    // whose resolver answers ::1 first, the default binds a socket the probe
    // (and Playwright) then cannot reach, and the lane reports "never ready"
    // about a server that is up.
    log(`Starting vite preview on 127.0.0.1:${webPort}`);
    const web = spawn(
      'pnpm',
      ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
      {
        cwd: join(root, 'apps', 'web'),
        env: childEnv({ VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` }),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push({ name: 'web', child: web });
    let webOutput = '';
    web.stdout?.on('data', (chunk: Buffer) => {
      webOutput += chunk.toString();
    });
    web.stderr?.on('data', (chunk: Buffer) => {
      webOutput += chunk.toString();
    });

    const webFailure = await waitFor(() => probe(`http://127.0.0.1:${webPort}/`), {
      timeoutMs: 60_000,
      intervalMs: 1_000,
      abort: () =>
        web.exitCode === null ? null : `vite preview exited with ${String(web.exitCode)}`,
    });
    if (webFailure !== null) {
      throw new Error(`The web app never became ready (${webFailure}).\n${webOutput}`);
    }

    const junitFile = join(root, 'apps', 'web', 'playwright-report', 'e2e-lane.junit.xml');
    log('Running Playwright');
    const playwright = run(
      'pnpm',
      [
        '--filter',
        '@repo/web',
        'exec',
        'playwright',
        'test',
        '--retries=0',
        '--reporter=list,junit',
        ...(options.playwrightArgs ?? []),
      ],
      {
        cwd: root,
        env: {
          // CI=1 reproduces the CI shape: one worker, so the per-IP login
          // budgets the whole suite shares are spent serially.
          CI: '1',
          PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
          PLAYWRIGHT_JUNIT_OUTPUT_NAME: junitFile,
          ADMIN_EMAIL: E2E_ADMIN.email,
          ADMIN_PASSWORD: E2E_ADMIN.password,
          // The two mail-link journeys read the invite out of the catcher the
          // api delivered it to, which is this sandbox's, not the dev stack's.
          MAILPIT_URL: mailpitHttpUrl(descriptor),
        },
        inherit: true,
        stdoutToStderr: options.quietStdout === true,
      },
    );

    return { status: playwright.status, junitFile, apiPort, webPort };
  } finally {
    teardown();
  }
}
