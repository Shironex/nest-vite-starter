import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { invariantManifestFreshRule } from './invariant-manifest-fresh';

/*
 * The rule reads the ids off the rule modules it can see, so the fixture ships
 * one, and the failing case cites an id no module declares.
 */
const DEMO_RULE = [
  "import type { IMetaRule } from '../../types';",
  '',
  'export const demoRule: IMetaRule = {',
  "  id: 'demo-rule',",
  "  category: 'config',",
  "  description: 'A fixture rule.',",
  '  run: () => [],',
  '};',
  '',
].join('\n');

function fixtureWith(manifest: string) {
  return createFixture({
    'apps/api/src/demo/demo.service.ts': 'export class DemoService {}\n',
    'tools/lint-meta/rules/config/demo-rule.ts': DEMO_RULE,
    'docs/invariants/demo.md': [
      '---',
      'subsystem: Demo',
      'globs:',
      '  - apps/api/src/demo/*.ts',
      '---',
      '',
      manifest,
      '',
    ].join('\n'),
  });
}

describe('invariant-manifest-fresh', () => {
  it('reports a manifest that cites a rule the registry does not have', () => {
    const fixture = fixtureWith('### It holds\n\n**Enforced by:** `lint-meta:deleted-rule`\n');

    const violations = runSync(invariantManifestFreshRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'invariant-manifest-fresh');
    assert.match(violations[0]?.message ?? '', /deleted-rule/u);
  });

  it('passes when every citation still exists', () => {
    const fixture = fixtureWith(
      '### It holds\n\n**Enforced by:** `lint-meta:demo-rule`, `file:apps/api/src/demo/demo.service.ts`\n',
    );

    assert.deepEqual(runSync(invariantManifestFreshRule, fixture.context()), []);
  });

  it('is quiet in a repository with no manifests at all', () => {
    const fixture = createFixture({ 'apps/api/src/demo/demo.service.ts': 'export class D {}\n' });

    assert.deepEqual(runSync(invariantManifestFreshRule, fixture.context()), []);
  });
});
