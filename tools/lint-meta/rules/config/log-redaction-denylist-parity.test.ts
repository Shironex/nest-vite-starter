import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, eslintConfigSource, runAsync } from '../../test-support';
import {
  checkLogRedactionDenylistParity,
  logRedactionDenylistParityRule,
} from './log-redaction-denylist-parity';

const PATTERNS = 'packages/shared/src/logger/index.ts';
const ESLINT_CONFIG = 'apps/api/eslint.config.mjs';
const LINT_RULE = 'observability/no-sensitive-fields-in-logs';

function patternsSource(patterns: readonly string[]): string {
  const entries = patterns.map((pattern) => `  '${pattern}', // ${pattern} comment`).join('\n');
  return [
    '/** A doc comment that mentions SENSITIVE_KEY_PATTERNS = [ but is not the declaration. */',
    `export const SENSITIVE_KEY_PATTERNS = [\n${entries}\n] as const;`,
    '',
  ].join('\n');
}

function eslintSource(denyNames: readonly string[] | null): string {
  const entry = denyNames === null ? 'error' : ['error', { denyNames }];
  return eslintConfigSource({ [LINT_RULE]: entry });
}

/** A fixture whose runtime list and lint option agree. */
function agreeing(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [PATTERNS]: patternsSource(['password', 'token', 'sessionid']),
    [ESLINT_CONFIG]: eslintSource(['password', 'token', 'sessionid']),
    ...overrides,
  };
}

async function check(files: Record<string, string>) {
  const fixture = createFixture(files);
  return checkLogRedactionDenylistParity(fixture.root);
}

describe('log-redaction-denylist-parity', () => {
  it('passes when the runtime list and the lint option agree', async () => {
    assert.deepEqual(await check(agreeing()), []);
  });

  it('reports a runtime pattern the lint option does not list', async () => {
    const violations = await check(
      agreeing({ [PATTERNS]: patternsSource(['password', 'token', 'sessionid', 'iban']) }),
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'log-redaction-denylist-parity');
    assert.match(violations[0]?.message ?? '', /'iban' is redacted at runtime/u);
    assert.match(violations[0]?.message ?? '', /MISSING from the `denyNames` option/u);
  });

  it('reports a lint name the runtime redactor does not know', async () => {
    const violations = await check(
      agreeing({ [ESLINT_CONFIG]: eslintSource(['password', 'token', 'sessionid', 'nickname']) }),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /'nickname' is in the `denyNames` option/u);
    assert.match(violations[0]?.message ?? '', /MISSING from SENSITIVE_KEY_PATTERNS/u);
  });

  it('reports a rule that resolves with no denyNames, so it falls back to the short default', async () => {
    const violations = await check(agreeing({ [ESLINT_CONFIG]: eslintSource(null) }));

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /resolves with no `denyNames` option/u);
  });

  it('reports a rule that never made it into the resolved config', async () => {
    const violations = await check(
      agreeing({ [ESLINT_CONFIG]: eslintConfigSource({ 'repo/unrelated': 'error' }) }),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /resolves with no `denyNames` option/u);
  });

  it('ignores a pattern mentioned only inside a comment', async () => {
    const source = `${patternsSource(['password', 'token', 'sessionid'])}// 'commented-out',\n`;

    assert.deepEqual(await check(agreeing({ [PATTERNS]: source })), []);
  });

  it('fails closed when the runtime list cannot be located', async () => {
    const violations = await check(
      agreeing({ [PATTERNS]: 'export const SOMETHING_ELSE = ["password"];\n' }),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /Could not read the `SENSITIVE_KEY_PATTERNS`/u);
  });

  it('reports a missing shared logger file', async () => {
    const files = agreeing();
    const fixture = createFixture({ [ESLINT_CONFIG]: files[ESLINT_CONFIG] ?? '' });
    const violations = await checkLogRedactionDenylistParity(fixture.root);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /shared logger is missing/u);
  });

  it('is a ciCritical config rule that runs through the async path', async () => {
    assert.equal(logRedactionDenylistParityRule.category, 'config');
    assert.equal(logRedactionDenylistParityRule.ciCritical, true);

    const fixture = createFixture(agreeing());
    assert.deepEqual(await runAsync(logRedactionDenylistParityRule, fixture.context()), []);
  });
});
