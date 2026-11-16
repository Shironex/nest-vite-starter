import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { docsFeatureInventoryCompleteRule } from './docs-feature-inventory-complete';

const INVENTORY = 'apps/docs/src/content/docs/frontend/features-inventory.md';

function inventory(rows: readonly string[]): string {
  return [
    '---',
    'title: Features',
    '---',
    '',
    '| Feature | Covers | Docs |',
    '| --- | --- | --- |',
    ...rows.map((name) => `| \`${name}\` | something | Below |`),
    '',
  ].join('\n');
}

describe('docs-feature-inventory-complete', () => {
  it('reports a feature directory that has no table row', () => {
    const fixture = createFixture({
      'apps/web/src/features/billing/index.ts': 'export {};\n',
      'apps/web/src/features/reports/index.ts': 'export {};\n',
      [INVENTORY]: inventory(['billing']),
    });

    const violations = runSync(docsFeatureInventoryCompleteRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'docs-feature-inventory-complete');
    assert.match(violations[0]?.message ?? '', /Feature `reports` exists/u);
  });

  it('passes when every feature directory has a row', () => {
    const fixture = createFixture({
      'apps/web/src/features/billing/index.ts': 'export {};\n',
      'apps/web/src/features/reports/index.ts': 'export {};\n',
      [INVENTORY]: inventory(['billing', 'reports']),
    });

    assert.deepEqual(runSync(docsFeatureInventoryCompleteRule, fixture.context()), []);
  });

  it('does not accept a bare mention in prose as a row', () => {
    const fixture = createFixture({
      'apps/web/src/features/reports/index.ts': 'export {};\n',
      [INVENTORY]: 'The reports feature is undocumented.\n\nSee `reports` for later.\n',
    });

    assert.equal(runSync(docsFeatureInventoryCompleteRule, fixture.context()).length, 1);
  });

  it('reports every missing feature, and ignores loose files in the features directory', () => {
    const fixture = createFixture({
      'apps/web/src/features/a/index.ts': 'export {};\n',
      'apps/web/src/features/b/index.ts': 'export {};\n',
      'apps/web/src/features/README.md': 'not a feature\n',
      [INVENTORY]: inventory([]),
    });

    assert.equal(runSync(docsFeatureInventoryCompleteRule, fixture.context()).length, 2);
  });

  it('reports a missing inventory page once features exist', () => {
    const fixture = createFixture({ 'apps/web/src/features/a/index.ts': 'export {};\n' });

    const violations = runSync(docsFeatureInventoryCompleteRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /Missing inventory page/u);
  });

  it('is dormant when there is no features directory', () => {
    assert.deepEqual(runSync(docsFeatureInventoryCompleteRule, createFixture().context()), []);
  });
});
