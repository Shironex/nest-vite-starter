import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { tempDir } from './test-support';

/*
 * The CI path filter, tested for the property that matters: which way it fails.
 * `pnpm` is a stub on PATH that prints whatever the case wants turbo to have
 * printed and exits with whatever status it wants turbo to have exited with,
 * so every "the probe could not tell" shape is reachable without a turbo run.
 * node is real: the counting is its job, and stubbing it would test nothing.
 */
interface IHarness {
  readonly bin: string;
  readonly log: string;
  readonly githubOutput: string;
}

function harness(): IHarness {
  const dir = tempDir('affected-stub');
  const log = join(dir, 'calls.log');
  const githubOutput = join(dir, 'github-output');
  writeFileSync(log, '');
  writeFileSync(githubOutput, '');

  const pnpm = join(dir, 'pnpm');
  writeFileSync(
    pnpm,
    `#!/bin/sh
echo "ARGS=$*" >> "${log}"
printf '%s' "\${STUB_TURBO_OUT:-}"
exit "\${STUB_TURBO_EXIT:-0}"
`,
  );
  chmodSync(pnpm, 0o755);

  return { bin: dir, log, githubOutput };
}

function runAffected(
  bin: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): { status: number; stdout: string } {
  const result = spawnSync('bash', [join(process.cwd(), 'scripts', 'ci', 'affected.sh'), ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, ...env },
  });
  return { status: result.status ?? -1, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const TASKS = (count: number): string =>
  JSON.stringify({ tasks: Array.from({ length: count }, (_, i) => ({ taskId: `task#${i}` })) });

describe('CI affected probe', () => {
  it('runs the job without asking turbo when the whole graph runs anyway', () => {
    const { bin, log } = harness();

    const result = runAffected(bin, ['test', '--filter=@repo/api'], { TURBO_AFFECTED: '' });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^run=true$/mu);
    assert.equal(readFileSync(log, 'utf8'), '');
  });

  it('skips the work when turbo reports zero affected tasks', () => {
    const { bin } = harness();

    const result = runAffected(bin, ['test', '--filter=@repo/api'], {
      TURBO_AFFECTED: '--affected',
      STUB_TURBO_OUT: TASKS(0),
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^run=false$/mu);
  });

  it('runs the work when turbo reports affected tasks', () => {
    const { bin } = harness();

    const result = runAffected(bin, ['test', '--filter=@repo/api'], {
      TURBO_AFFECTED: '--affected',
      STUB_TURBO_OUT: TASKS(2),
    });

    assert.match(result.stdout, /^run=true$/mu);
  });

  it('runs the work when turbo itself fails', () => {
    const { bin } = harness();

    const result = runAffected(bin, ['test', '--filter=@repo/api'], {
      TURBO_AFFECTED: '--affected',
      STUB_TURBO_EXIT: '1',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^run=true$/mu);
  });

  it('runs the work when the probe output is not JSON', () => {
    const { bin } = harness();

    const result = runAffected(bin, ['test', '--filter=@repo/api'], {
      TURBO_AFFECTED: '--affected',
      STUB_TURBO_OUT: 'turbo: command not found',
    });

    assert.match(result.stdout, /^run=true$/mu);
  });

  it('runs the work when the JSON parses but carries no task list', () => {
    const { bin } = harness();

    const result = runAffected(bin, ['test', '--filter=@repo/api'], {
      TURBO_AFFECTED: '--affected',
      STUB_TURBO_OUT: '{"packages":[]}',
    });

    assert.match(result.stdout, /^run=true$/mu);
  });

  it('passes every filter it was given through to turbo', () => {
    const { bin, log } = harness();

    runAffected(bin, ['test:e2e', '--filter=@repo/web', '--filter=@repo/api'], {
      TURBO_AFFECTED: '--affected',
      STUB_TURBO_OUT: TASKS(1),
    });

    assert.match(
      readFileSync(log, 'utf8'),
      /^ARGS=exec turbo run test:e2e --filter=@repo\/web --filter=@repo\/api --affected --dry=json$/mu,
    );
  });

  it('writes the answer to GITHUB_OUTPUT for the steps that gate on it', () => {
    const { bin, githubOutput } = harness();

    runAffected(bin, ['test', '--filter=@repo/api'], {
      TURBO_AFFECTED: '--affected',
      STUB_TURBO_OUT: TASKS(0),
      GITHUB_OUTPUT: githubOutput,
    });

    assert.equal(readFileSync(githubOutput, 'utf8'), 'run=false\n');
  });

  it('fails loudly rather than answering when it is called without a filter', () => {
    const { bin } = harness();

    const result = runAffected(bin, ['test'], { TURBO_AFFECTED: '--affected' });

    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /^run=/mu);
  });
});
