import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import {
  checkNoHardcodedDatesInFixtures,
  isFixtureFile,
  noHardcodedDatesInFixturesRule,
} from './no-hardcoded-dates-in-fixtures';

const SUPPORT = 'apps/web/e2e/support/invoices.ts';

describe('no-hardcoded-dates-in-fixtures', () => {
  it('reports an inline date in an e2e support helper, with its line number', () => {
    const fixture = createFixture({
      [SUPPORT]: ['export async function fill(f) {', "  await f('2026-01-15');", '}', ''].join(
        '\n',
      ),
    });

    const violations = runSync(noHardcodedDatesInFixturesRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'no-hardcoded-dates-in-fixtures');
    assert.equal(violations[0]?.file, SUPPORT);
    assert.match(violations[0]?.message ?? '', /^Line 2: the literal date `2026-01-15`/u);
  });

  it('reports an inline date inside a full ISO timestamp', () => {
    const fixture = createFixture({
      'apps/api/test/fixtures.ts':
        "export const f = { createdAt: new Date('2026-01-01T00:00:00Z') };\n",
    });

    assert.equal(checkNoHardcodedDatesInFixtures(fixture.context()).length, 1);
  });

  it('accepts a date hoisted to a module-scope named constant', () => {
    const fixture = createFixture({
      [SUPPORT]: [
        "const FIXTURE_BIRTH_DATE = '1990-05-15';",
        "const FIXED_CREATED_AT: Date = new Date('2026-01-01T00:00:00Z');",
        'export { FIXTURE_BIRTH_DATE, FIXED_CREATED_AT };',
        '',
      ].join('\n'),
    });

    assert.deepEqual(checkNoHardcodedDatesInFixtures(fixture.context()), []);
  });

  it('accepts a derived date, and ignores a date named in a comment', () => {
    const fixture = createFixture({
      [SUPPORT]: [
        '// Rewritten in the 2026-08-28 UI pass.',
        'export const recent = daysAgo(30);',
        '',
      ].join('\n'),
    });

    assert.deepEqual(checkNoHardcodedDatesInFixtures(fixture.context()), []);
  });

  it('covers files that call themselves fixtures, wherever they live', () => {
    const fixture = createFixture({
      'apps/web/src/features/invoices/Invoices.fixtures.ts': "export const a = '2026-08-01';\n",
      'packages/ui/tests/fixtures/rows.ts': "export const b = '2026-08-01';\n",
    });

    assert.deepEqual(
      checkNoHardcodedDatesInFixtures(fixture.context())
        .map((violation) => violation.file)
        .sort(),
      ['apps/web/src/features/invoices/Invoices.fixtures.ts', 'packages/ui/tests/fixtures/rows.ts'],
    );
  });

  it('leaves specs alone: a date spelled out there is the assertion', () => {
    const fixture = createFixture({
      'apps/web/src/features/invoices/Due.test.ts': "expect(row).toHaveText('2026-01-15');\n",
    });

    assert.deepEqual(checkNoHardcodedDatesInFixtures(fixture.context()), []);
  });

  it('is dormant on a tree with no fixtures at all', () => {
    assert.deepEqual(checkNoHardcodedDatesInFixtures(createFixture().context()), []);
  });
});

describe('isFixtureFile', () => {
  it('recognizes the fixture shapes this repo uses, and nothing else', () => {
    assert.equal(isFixtureFile('apps/api/test/fixtures.ts'), true);
    assert.equal(isFixtureFile('apps/web/src/features/invoices/Invoices.fixtures.ts'), true);
    assert.equal(isFixtureFile('packages/ui/tests/fixtures/rows.ts'), true);
    assert.equal(isFixtureFile('apps/api/src/modules/user/user.service.ts'), false);
    assert.equal(isFixtureFile('apps/web/src/lib/fixture-loader.ts'), false);
  });
});
