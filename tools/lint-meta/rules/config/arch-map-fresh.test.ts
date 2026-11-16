import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { buildPages } from '../../../arch/build-map';
import { createFixture, runSync, type IFixture } from '../../test-support';
import { archMapFreshRule } from './arch-map-fresh';

/*
 * The rule reads the real purpose registry, so the fixture uses two directory
 * names that already have a purpose line (`audit`, `auth`) and adds an invented
 * one when it wants the missing-purpose branch.
 */
function tree(): IFixture {
  return createFixture({
    'apps/api/src/modules/audit/audit.service.ts': 'export class AuditService {}\n',
    'apps/web/src/features/auth/Auth.tsx': 'export const Auth = 1;\n',
  });
}

function generate(fixture: IFixture): void {
  for (const page of buildPages(fixture.root)) {
    const absolute = join(fixture.root, ...page.path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, page.content, 'utf8');
  }
}

describe('arch-map-fresh', () => {
  it('reports a committed page that no longer matches the tree', () => {
    const fixture = tree();
    generate(fixture);
    fixture.write({ 'apps/api/src/modules/audit/extra.service.ts': 'export class Extra {}\n' });

    const violations = runSync(archMapFreshRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'arch-map-fresh');
    assert.match(violations[0]?.message ?? '', /out of date/u);
  });

  it('reports a module directory with no purpose line', () => {
    const fixture = tree();
    generate(fixture);
    fixture.write({ 'apps/api/src/modules/quux/quux.service.ts': 'export class Quux {}\n' });

    const messages = runSync(archMapFreshRule, fixture.context()).map(
      (violation) => violation.message,
    );

    assert.ok(messages.some((message) => /no purpose line/u.test(message)));
  });

  it('passes on a freshly generated pair', () => {
    const fixture = tree();
    generate(fixture);

    assert.deepEqual(runSync(archMapFreshRule, fixture.context()), []);
  });
});
