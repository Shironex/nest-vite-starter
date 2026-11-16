import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { createFixture, type IFixture } from '../lint-meta/test-support';
import { buildPages, checkArchMap, missingPurposes } from './build-map';
import type { IPurposeRegistry } from './registry';

const REGISTRY: IPurposeRegistry = {
  apiModules: { alpha: 'The alpha module.' },
  webFeatures: { beta: 'The beta feature.' },
};

function tree(): IFixture {
  return createFixture({
    'apps/api/src/modules/alpha/alpha.service.ts': 'export class AlphaService {}\n',
    'apps/web/src/features/beta/Beta.tsx': 'export const Beta = 1;\n',
  });
}

/** Write the pages the generator would write, so only the tested drift remains. */
function generate(fixture: IFixture, registry: IPurposeRegistry = REGISTRY): void {
  for (const page of buildPages(fixture.root, registry)) {
    const absolute = join(fixture.root, ...page.path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, page.content, 'utf8');
  }
}

describe('missingPurposes', () => {
  it('reports a directory with no purpose line', () => {
    const fixture = tree();
    fixture.write({ 'apps/api/src/modules/gamma/gamma.service.ts': 'export class G {}\n' });

    const problems = missingPurposes(fixture.root, REGISTRY);

    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.file, 'apps/api/src/modules/gamma');
    assert.match(problems[0]?.message ?? '', /no purpose line/u);
  });

  it('is quiet when every directory has one', () => {
    assert.deepEqual(missingPurposes(tree().root, REGISTRY), []);
  });
});

describe('checkArchMap', () => {
  it('reports a page that was never generated', () => {
    const problems = checkArchMap(tree().root, REGISTRY);

    assert.equal(problems.length, 2);
    assert.match(problems[0]?.message ?? '', /missing/u);
  });

  it('passes on a freshly generated pair', () => {
    const fixture = tree();
    generate(fixture);

    assert.deepEqual(checkArchMap(fixture.root, REGISTRY), []);
  });

  it('reports the map as stale once a new module appears', () => {
    const fixture = tree();
    generate(fixture);
    fixture.write({ 'apps/api/src/modules/gamma/gamma.service.ts': 'export class G {}\n' });

    const problems = checkArchMap(fixture.root, {
      ...REGISTRY,
      apiModules: { ...REGISTRY.apiModules, gamma: 'The gamma module.' },
    });

    assert.equal(problems.length, 1);
    assert.match(problems[0]?.message ?? '', /out of date/u);
  });
});
