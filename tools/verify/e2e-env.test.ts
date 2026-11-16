import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CI_E2E_ENV_INPUT, E2E_ADMIN, e2eApiEnv } from './e2e-env';

/*
 * The parity test the drift this module exists to prevent would have to get
 * past. It reads the values out of ci.yml and compares them with the module, so
 * a key changed in one place and not the other is a failed build rather than a
 * journey that only breaks on the runner.
 */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function envBlockAfter(lines: readonly string[], startIndex: number): Record<string, string> {
  const env: Record<string, string> = {};
  let blockIndent: number | null = null;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    if (blockIndent === null) {
      if (line.trim() === 'env:') {
        blockIndent = indentOf(line);
      }
      continue;
    }
    if (indentOf(line) <= blockIndent) {
      break;
    }
    const match = /^\s+([A-Z0-9_]+):\s*(.*)$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      env[match[1]] = match[2]
        .trim()
        .replace(/^'(.*)'$/u, '$1')
        .replace(/^"(.*)"$/u, '$1');
    }
  }

  return env;
}

function workflow(): string[] {
  return readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8').split('\n');
}

describe('e2e env parity with CI', () => {
  it('matches the env of the workflow Start API step, key for key', () => {
    const lines = workflow();
    const stepIndex = lines.findIndex((line) => line.trim() === '- name: Start API');
    assert.notEqual(stepIndex, -1, 'ci.yml no longer has a "Start API" step');

    const ciEnv = envBlockAfter(lines, stepIndex);
    const ours = e2eApiEnv(CI_E2E_ENV_INPUT);

    assert.ok(Object.keys(ciEnv).length > 5, 'the Start API env block did not parse');
    for (const [key, value] of Object.entries(ciEnv)) {
      assert.equal(ours[key], value, `${key} differs between ci.yml and tools/verify/e2e-env.ts`);
    }
  });

  it('covers the database and redis URLs the e2e job sets at job level', () => {
    const lines = workflow();
    const jobIndex = lines.findIndex((line) => line.trim() === 'test-e2e:');
    assert.notEqual(jobIndex, -1);

    const ciEnv = envBlockAfter(
      lines.slice(0, jobIndex + 400),
      lines.indexOf('    env:', jobIndex),
    );
    const ours = e2eApiEnv(CI_E2E_ENV_INPUT);

    assert.equal(ours['DATABASE_URL'], ciEnv['DATABASE_URL']);
    assert.equal(ours['REDIS_URL'], ciEnv['REDIS_URL']);
  });

  it('seeds and signs in as the admin the workflow seeds', () => {
    const lines = workflow();
    const stepIndex = lines.findIndex((line) => line.trim() === '- name: Seed admin user');
    assert.notEqual(stepIndex, -1);

    const ciEnv = envBlockAfter(lines, stepIndex);

    assert.equal(ciEnv['ADMIN_EMAIL'], E2E_ADMIN.email);
    assert.equal(ciEnv['ADMIN_PASSWORD'], E2E_ADMIN.password);
  });

  it('moves both origins with the ports it is given', () => {
    const env = e2eApiEnv({ ...CI_E2E_ENV_INPUT, apiPort: 41_001, webPort: 41_002 });

    assert.equal(env['PORT'], '41001');
    assert.equal(env['API_PUBLIC_URL'], 'http://localhost:41001');
    assert.equal(env['APP_URL'], 'http://localhost:41002');
  });
});
