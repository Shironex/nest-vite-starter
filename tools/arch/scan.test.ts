import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture } from '../lint-meta/test-support';
import { resolveUnit, scanGroup } from './scan';

const SPEC = { id: 'api-modules', dir: 'apps/api/src/modules', aliasPrefix: '@/modules/' } as const;

function modulesFixture(files: Readonly<Record<string, string>>) {
  return createFixture(files);
}

describe('scanGroup', () => {
  it('reports a relative cross-module import with a file:line witness', () => {
    const fixture = modulesFixture({
      'apps/api/src/modules/alpha/alpha.service.ts': [
        "import { join } from 'node:path';",
        '',
        "import { BetaService } from '../beta/beta.service';",
        '',
        'export class AlphaService {}',
        `export const used = [join, BetaService];`,
      ].join('\n'),
      'apps/api/src/modules/beta/beta.service.ts': 'export class BetaService {}\n',
    });

    const group = scanGroup(fixture.root, SPEC);
    const alpha = group.units.find((unit) => unit.name === 'alpha');
    const beta = group.units.find((unit) => unit.name === 'beta');

    assert.deepEqual(alpha?.dependsOn, [
      {
        to: 'beta',
        witnesses: [{ file: 'apps/api/src/modules/alpha/alpha.service.ts', line: 3 }],
      },
    ]);
    assert.deepEqual(beta?.dependents, ['alpha']);
    assert.deepEqual(alpha?.dependents, []);
  });

  it('resolves an alias import and counts every witness of one edge', () => {
    const fixture = modulesFixture({
      'apps/api/src/modules/alpha/one.ts': "export * from '@/modules/beta/beta.service';\n",
      'apps/api/src/modules/alpha/two.ts': "export * from '@/modules/beta/other';\n",
      'apps/api/src/modules/beta/beta.service.ts': 'export class BetaService {}\n',
      'apps/api/src/modules/beta/other.ts': 'export const other = 1;\n',
    });

    const alpha = scanGroup(fixture.root, SPEC).units.find((unit) => unit.name === 'alpha');

    assert.equal(alpha?.dependsOn.length, 1);
    assert.equal(alpha?.dependsOn[0]?.witnesses.length, 2);
    assert.equal(alpha?.dependsOn[0]?.witnesses[0]?.file, 'apps/api/src/modules/alpha/one.ts');
  });

  it('ignores tests and stories in both the counts and the edges', () => {
    const fixture = modulesFixture({
      'apps/api/src/modules/alpha/alpha.service.ts': 'export class AlphaService {}\n',
      'apps/api/src/modules/alpha/alpha.service.spec.ts':
        "import { BetaService } from '../beta/beta.service';\nexport const used = BetaService;\n",
      'apps/api/src/modules/beta/beta.service.ts': 'export class BetaService {}\n',
    });

    const alpha = scanGroup(fixture.root, SPEC).units.find((unit) => unit.name === 'alpha');

    assert.equal(alpha?.files, 1);
    assert.deepEqual(alpha?.dependsOn, []);
  });

  it('ignores imports that leave the group or stay inside the unit', () => {
    const fixture = modulesFixture({
      'apps/api/src/modules/alpha/alpha.service.ts': [
        "import { clock } from '../../common/clock';",
        "import { helper } from './helper';",
        "import { z } from 'zod';",
        'export const used = [clock, helper, z];',
      ].join('\n'),
      'apps/api/src/modules/alpha/helper.ts': 'export const helper = 1;\n',
      'apps/api/src/common/clock.ts': 'export const clock = 1;\n',
    });

    const alpha = scanGroup(fixture.root, SPEC).units.find((unit) => unit.name === 'alpha');

    assert.deepEqual(alpha?.dependsOn, []);
  });
});

describe('resolveUnit', () => {
  it('returns null for a specifier that climbs out of the group', () => {
    assert.equal(
      resolveUnit('../../common/clock', '/repo/modules/alpha/a.ts', '/repo/modules', undefined),
      null,
    );
  });

  it('names the unit a relative specifier lands in', () => {
    assert.equal(
      resolveUnit('../beta/beta.service', '/repo/modules/alpha/a.ts', '/repo/modules', undefined),
      'beta',
    );
  });
});
