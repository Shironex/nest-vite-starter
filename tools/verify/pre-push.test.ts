import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { freePort } from './ports';
import { fakePostgres, tempDir } from './test-support';

/*
 * Hermetic: `pnpm`, `gitleaks` and `docker` are stubs on PATH, so the real
 * gates never run and the test is about the script's own decisions: which
 * database it talks to, which scanner it accepts, and whether a gate it could
 * not run is allowed to read as a pass. The stub records every invocation with
 * the DATABASE_URL it saw.
 *
 * node is NOT stubbed: the database probe is a real one now (it speaks the
 * Postgres startup handshake), so "a database answered" means a server that
 * really answered, and `test-support`'s fake Postgres is what answers it.
 */
type GitleaksStub = 'match' | 'mismatch' | 'absent';
type DockerStub = 'up' | 'down' | 'absent';

interface IStubs {
  readonly gitleaks?: GitleaksStub;
  readonly docker?: DockerStub;
}

interface IHarness {
  readonly bin: string;
  readonly log: string;
}

const PRE_PUSH = join('scripts', 'ci', 'pre-push.sh');

/** The gitleaks version the hook pins, read from the hook so a bump cannot strand this test. */
function pinnedGitleaksVersion(): string {
  const text = readFileSync(join(process.cwd(), PRE_PUSH), 'utf8');
  const pinned = /GITLEAKS_VERSION="([0-9]+\.[0-9]+\.[0-9]+)"/u.exec(text);
  assert.ok(pinned !== null, 'pre-push.sh must pin a gitleaks version');
  return pinned[1] ?? '';
}

function writeStub(file: string, body: string): void {
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

function harness({ gitleaks = 'mismatch', docker = 'up' }: IStubs = {}): IHarness {
  const dir = tempDir('pre-push-stub');
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');

  writeStub(
    join(dir, 'pnpm'),
    `#!/bin/sh
echo "ARGS=$* DATABASE_URL=\${DATABASE_URL:-}" >> "${log}"
case "$*" in
  *sandbox:inspect*)
    if [ -n "\${STUB_LANE_URL:-}" ]; then echo "\${STUB_LANE_URL}"; exit 0; fi
    exit 1
    ;;
esac
if [ -n "\${STUB_FAIL_MATCH:-}" ]; then
  case "$*" in
    *"\${STUB_FAIL_MATCH}"*) exit 1 ;;
  esac
fi
exit 0
`,
  );

  if (gitleaks !== 'absent') {
    const version = gitleaks === 'match' ? pinnedGitleaksVersion() : '8.18.0';
    writeStub(
      join(dir, 'gitleaks'),
      `#!/bin/sh
echo "GITLEAKS $*" >> "${log}"
case "$1" in
  version) echo "${version}" ;;
esac
exit 0
`,
    );
  }

  if (docker !== 'absent') {
    writeStub(
      join(dir, 'docker'),
      `#!/bin/sh
echo "DOCKER $*" >> "${log}"
case "$1" in
  info) exit ${docker === 'down' ? '1' : '0'} ;;
esac
exit 0
`,
    );
  }

  return { bin: dir, log };
}

/*
 * Spawned asynchronously, not with spawnSync: the fake Postgres the probe now
 * talks to lives in THIS process, and a synchronous spawn blocks the event
 * loop that would have to answer it. The hook would then always see a port
 * that never replies.
 */
/**
 * A directory of symlinks to the real tools `pre-push.sh` needs, and nothing
 * else. Built once and reused, so an "absent" stub is genuinely absent whatever
 * the host keeps in /usr/bin.
 */
/*
 * Every external command `pre-push.sh` runs, other than the ones this file stubs
 * (pnpm, gitleaks, docker). Enumerated from the script rather than guessed: a
 * missing one does not look like a missing tool, it looks like a gate failing.
 * `head` and `tail` were the two that did exactly that.
 */
const REAL_TOOLS = ['sh', 'bash', 'git', 'grep', 'head', 'tail', 'dirname', 'rm', 'env', 'uname'];

/*
 * Built at module load, not on first use. `tempDir` registers its cleanup with
 * `after()`, which attaches to whatever test is running at the time, so a lazily
 * created directory is deleted when that first test ends and every later test
 * gets a PATH pointing at nothing.
 */
const REAL_TOOLS_DIR = ((): string => {
  const dir = tempDir('pre-push-real');
  for (const tool of REAL_TOOLS) {
    const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
    const target = found.stdout.trim().split('\n')[0] ?? '';
    if (target !== '') symlinkSync(target, join(dir, tool));
  }
  return dir;
})();

async function runPrePush(
  bin: string,
  env: Readonly<Record<string, string>>,
  stdin = '',
): Promise<{ status: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', [join(process.cwd(), PRE_PUSH)], {
      cwd: process.cwd(),
      env: {
        /*
         * PATH holds the stub dir, node, and symlinks to the handful of real
         * tools the hook needs. It must NOT hold /usr/bin, because a stub set to
         * "absent" only means absent if `command -v` cannot find the real thing
         * anywhere. Docker lives in /usr/local/bin on macOS and /usr/bin on a
         * GitHub runner, so including /usr/bin made "no Docker" pass locally and
         * silently find the real Docker in CI: the hook pulled the pinned
         * gitleaks image, scanned, and allowed the push. A test for "the gate
         * refuses" that only refuses on one developer's machine is worse than no
         * test, so the allowed tools are listed rather than inherited.
         */
        PATH: `${bin}:${dirname(process.execPath)}:${REAL_TOOLS_DIR}`,
        HOME: bin,
        ...env,
      },
    });

    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stdin.end(stdin);
    child.on('close', (code) => resolve({ status: code ?? -1, stdout: output }));
  });
}

/** Env pointing the Prisma gates at a database that really answers. */
async function readyDatabase(): Promise<Record<string, string>> {
  const server = await fakePostgres('ready');
  return { PRE_PUSH_DB_HOST: '127.0.0.1', PRE_PUSH_DB_PORT: String(server.port) };
}

describe('pre-push incomplete semantics', () => {
  it('exits 2 INCOMPLETE when no database answers, instead of reporting success', async () => {
    const { bin } = harness();
    const closed = await freePort();

    const result = await runPrePush(bin, {
      PRE_PUSH_DB_HOST: '127.0.0.1',
      PRE_PUSH_DB_PORT: String(closed),
    });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /INCOMPLETE/u);
    assert.doesNotMatch(result.stdout, /✓ pre-push checks passed\.$/u);
  });

  it('lets the push through with PRE_PUSH_ALLOW_INCOMPLETE=1, still saying it was incomplete', async () => {
    const { bin } = harness();
    const closed = await freePort();

    const result = await runPrePush(bin, {
      PRE_PUSH_DB_HOST: '127.0.0.1',
      PRE_PUSH_DB_PORT: String(closed),
      PRE_PUSH_ALLOW_INCOMPLETE: '1',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /INCOMPLETE/u);
  });

  it('treats a force-skipped database gate as incomplete too', async () => {
    const { bin } = harness();

    const result = await runPrePush(bin, { PRE_PUSH_SKIP_DB: '1' });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /INCOMPLETE/u);
  });

  it('treats a skipped secret scan as incomplete', async () => {
    const { bin } = harness();

    const result = await runPrePush(bin, {
      PRE_PUSH_SKIP_GITLEAKS: '1',
      ...(await readyDatabase()),
    });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /INCOMPLETE/u);
  });

  it('passes with exit 0 when every gate ran', async () => {
    const { bin, log } = harness();

    const result = await runPrePush(bin, await readyDatabase());

    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /INCOMPLETE/u);
    assert.match(readFileSync(log, 'utf8'), /db:migrate:check/u);
    assert.match(readFileSync(log, 'utf8'), /db:migrate:status/u);
  });

  it('still exits 1 when a gate ran and failed', async () => {
    const { bin } = harness();

    const result = await runPrePush(bin, {
      ...(await readyDatabase()),
      STUB_FAIL_MATCH: 'lint:meta',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /pre-push checks failed/u);
  });

  it('points the Prisma gates at the sandbox lane when one is up', async () => {
    const { bin, log } = harness();
    const server = await fakePostgres('ready');

    const laneUrl = `postgresql://postgres:postgres@127.0.0.1:${server.port}/saas_starter_prisma_gates`;
    const result = await runPrePush(bin, { STUB_LANE_URL: laneUrl });

    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`sandbox lane on 127\\.0\\.0\\.1:${server.port}`, 'u'));
    const calls = readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line.includes('db:migrate:check'));
    assert.equal(calls.length, 1);
    assert.match(
      calls[0] ?? '',
      new RegExp(`DATABASE_URL=${laneUrl.replace(/[/.]/gu, '\\$&')}`, 'u'),
    );
  });

  it('runs the type check that covers tools/, which nothing else in the gate does', async () => {
    const { bin, log } = harness();

    await runPrePush(bin, await readyDatabase());

    assert.match(readFileSync(log, 'utf8'), /ARGS=check-types:tools/u);
  });
});

describe('pre-push database probe', () => {
  it('calls a port that is open but not answering as Postgres INCOMPLETE, not a pass', async () => {
    // The Docker case: the published port accepts the connection before the
    // server in the container listens. A TCP probe reads that as a database.
    const { bin, log } = harness();
    const server = await fakePostgres('silent');

    const result = await runPrePush(bin, {
      PRE_PUSH_DB_HOST: '127.0.0.1',
      PRE_PUSH_DB_PORT: String(server.port),
    });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /no database reachable/u);
    assert.doesNotMatch(readFileSync(log, 'utf8'), /db:migrate:check/u);
  });

  it('refuses another server holding the port', async () => {
    const { bin } = harness();
    const server = await fakePostgres('other-server');

    const result = await runPrePush(bin, {
      PRE_PUSH_DB_HOST: '127.0.0.1',
      PRE_PUSH_DB_PORT: String(server.port),
    });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /no database reachable/u);
  });

  it('runs the gates against a database that is up but refuses this connection', async () => {
    // Wrong credentials or a missing database is still a ready server: the
    // gates themselves are what should report that, not the probe.
    const { bin, log } = harness();
    const server = await fakePostgres('rejects');

    const result = await runPrePush(bin, {
      PRE_PUSH_DB_HOST: '127.0.0.1',
      PRE_PUSH_DB_PORT: String(server.port),
    });

    assert.equal(result.status, 0);
    assert.match(readFileSync(log, 'utf8'), /db:migrate:status/u);
  });
});

describe('pre-push secret scan', () => {
  /*
   * The guard for the guard. "No Docker" is only a real scenario if the PATH the
   * hook runs with cannot reach a real docker anywhere. When this PATH still
   * carried /usr/bin, the case passed on macOS (docker lives in /usr/local/bin)
   * and quietly found the real docker on a GitHub runner, where it is
   * /usr/bin/docker: the hook pulled the pinned gitleaks image, scanned, and
   * allowed the push. The test reported a gate that was not being exercised.
   */
  it('cannot reach a real gitleaks or docker when the stubs are absent', async () => {
    const { bin } = harness({ gitleaks: 'absent', docker: 'absent' });
    const path = `${bin}:${dirname(process.execPath)}:${REAL_TOOLS_DIR}`;

    for (const tool of ['docker', 'gitleaks']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], {
        encoding: 'utf8',
        env: { PATH: path },
      });
      assert.equal(found.status !== 0, true, `${tool} is reachable at ${found.stdout.trim()}`);
    }
  });

  it('fails the push when there is neither gitleaks nor Docker', async () => {
    const { bin } = harness({ gitleaks: 'absent', docker: 'absent' });

    const result = await runPrePush(bin, await readyDatabase());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /No usable gitleaks/u);
  });

  it('fails the push when Docker is installed but its daemon is down', async () => {
    const { bin, log } = harness({ gitleaks: 'absent', docker: 'down' });

    const result = await runPrePush(bin, await readyDatabase());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /daemon is not running/u);
    // It stopped at `docker info`; it never tried to run the image.
    assert.doesNotMatch(readFileSync(log, 'utf8'), /DOCKER run/u);
  });

  it('uses a native gitleaks that is CI’s version, and no Docker', async () => {
    const { bin, log } = harness({ gitleaks: 'match' });

    const result = await runPrePush(bin, await readyDatabase());
    const calls = readFileSync(log, 'utf8');

    assert.equal(result.status, 0);
    assert.match(calls, /GITLEAKS git \. --config \.gitleaks\.toml/u);
    assert.doesNotMatch(calls, /DOCKER run/u);
  });

  it('refuses a native gitleaks of another version and falls back to the pinned image', async () => {
    const { bin, log } = harness({ gitleaks: 'mismatch' });

    const result = await runPrePush(bin, await readyDatabase());
    const calls = readFileSync(log, 'utf8');

    assert.equal(result.status, 0);
    assert.match(result.stdout, /is not CI's/u);
    assert.doesNotMatch(calls, /GITLEAKS git \./u);
    assert.match(calls, /DOCKER run .*gitleaks:v/u);
  });

  it('skips only what PRE_PUSH_SKIP_GITLEAKS names: the database gates still run', async () => {
    const { bin, log } = harness();

    await runPrePush(bin, { PRE_PUSH_SKIP_GITLEAKS: '1', ...(await readyDatabase()) });
    const calls = readFileSync(log, 'utf8');

    assert.doesNotMatch(calls, /GITLEAKS|DOCKER/u);
    assert.match(calls, /db:migrate:check/u);
  });

  it('skips only what PRE_PUSH_SKIP_DB names: the secret scan still runs', async () => {
    const { bin, log } = harness({ gitleaks: 'match' });

    await runPrePush(bin, { PRE_PUSH_SKIP_DB: '1' });
    const calls = readFileSync(log, 'utf8');

    assert.match(calls, /GITLEAKS git \./u);
    assert.doesNotMatch(calls, /db:migrate:check/u);
  });
});

describe('pre-push hook protocol', () => {
  it('exits 0 with git ref lines on stdin, the way git really invokes it', async () => {
    // A pre-push hook is fed `<local ref> <local sha> <remote ref> <remote sha>`
    // on stdin. A gate that consumes stdin (or dies of SIGPIPE at 141 partway
    // through one) can abort the push while every gate above it says it passed.
    const { bin } = harness();
    const sha = '0e797a2cf1a8a3d6ac1cd0bb0aa2e3f47cf0a1b2';

    const result = await runPrePush(
      bin,
      await readyDatabase(),
      `refs/heads/main ${sha} refs/heads/main ${sha}\n`,
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /✓ pre-push checks passed\./u);
  });

  it('keeps running the later gates after one fails, and still exits 1', async () => {
    // The accumulator: the first gate failing must not short-circuit the rest,
    // or one failure hides every other one behind it.
    const { bin, log } = harness();

    const result = await runPrePush(bin, {
      ...(await readyDatabase()),
      STUB_FAIL_MATCH: 'build:packages',
    });
    const calls = readFileSync(log, 'utf8');

    assert.equal(result.status, 1);
    assert.match(calls, /ARGS=lint:meta/u);
    assert.match(calls, /ARGS=--filter @repo\/web knip/u);
    assert.match(calls, /db:migrate:check/u);
  });
});
