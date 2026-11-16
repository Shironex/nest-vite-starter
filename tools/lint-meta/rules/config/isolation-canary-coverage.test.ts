import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, messages, runSync } from '../../test-support';
import { isolationCanaryCoverageRule } from './isolation-canary-coverage';

const EXTENSION = 'apps/api/src/common/database/tenant-scope.extension.ts';
const MANIFEST = 'tools/canary/isolation-canary.json';

const extensionSource = (models: readonly string[]): string =>
  `export const TENANT_SCOPED_MODELS = {\n${models
    .map((model) => `  ${model}: ['tenantId'],`)
    .join('\n')}\n} as const;\n`;

const manifestSource = (mutants: Record<string, string[]>): string =>
  JSON.stringify({
    controlPrefix: 'control:',
    mutants: Object.fromEntries(
      Object.entries(mutants).map(([model, mustFail]) => [model, { why: 'x', mustFail }]),
    ),
  });

describe('isolation-canary-coverage', () => {
  it('passes when every scoped model and the pass-through mutant have a killing case', () => {
    const fixture = createFixture({
      [EXTENSION]: extensionSource(['workspace', 'invoice']),
      [MANIFEST]: manifestSource({ workspace: ['s F1'], invoice: ['s I1'], all: ['s F1', 's I1'] }),
    });

    assert.deepEqual(runSync(isolationCanaryCoverageRule, fixture.context()), []);
  });

  it('reports a scoped model with no mutant at all', () => {
    const fixture = createFixture({
      [EXTENSION]: extensionSource(['workspace', 'invoiceLine']),
      [MANIFEST]: manifestSource({ workspace: ['s F1'], all: ['s F1'] }),
    });

    const found = messages(runSync(isolationCanaryCoverageRule, fixture.context()));

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /`invoiceLine` is isolated by the tenant-scope extension/u);
  });

  it('reports a mutant that names no case, because nothing can catch it', () => {
    const fixture = createFixture({
      [EXTENSION]: extensionSource(['workspace']),
      [MANIFEST]: manifestSource({ workspace: [], all: ['s F1'] }),
    });

    const found = messages(runSync(isolationCanaryCoverageRule, fixture.context()));

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /names no case in `mustFail`/u);
  });

  it('requires the pass-through mutant as well as the per-model ones', () => {
    const fixture = createFixture({
      [EXTENSION]: extensionSource(['workspace']),
      [MANIFEST]: manifestSource({ workspace: ['s F1'] }),
    });

    const found = messages(runSync(isolationCanaryCoverageRule, fixture.context()));

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /`all` is isolated/u);
  });

  it('reports a stale mutant for a model the extension no longer isolates', () => {
    const fixture = createFixture({
      [EXTENSION]: extensionSource(['workspace']),
      [MANIFEST]: manifestSource({ workspace: ['s F1'], all: ['s F1'], invoice: ['s I1'] }),
    });

    const found = messages(runSync(isolationCanaryCoverageRule, fixture.context()));

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /not in `TENANT_SCOPED_MODELS`/u);
  });

  it('fails closed on an unparseable registry rather than reading as "nothing to cover"', () => {
    const fixture = createFixture({
      [EXTENSION]: 'export const SOMETHING_ELSE = {};\n',
      [MANIFEST]: manifestSource({ all: ['s F1'] }),
    });

    const found = messages(runSync(isolationCanaryCoverageRule, fixture.context()));

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /Could not read the `TENANT_SCOPED_MODELS` object literal/u);
  });

  it('reports a manifest that is not valid JSON', () => {
    const fixture = createFixture({
      [EXTENSION]: extensionSource(['workspace']),
      [MANIFEST]: '{ not json',
    });

    const found = messages(runSync(isolationCanaryCoverageRule, fixture.context()));

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /is not valid JSON/u);
  });
});
