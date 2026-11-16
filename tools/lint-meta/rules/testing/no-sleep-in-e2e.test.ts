import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { checkNoSleepInE2e, noSleepInE2eRule } from './no-sleep-in-e2e';

const SPEC = 'apps/web/e2e/journey.spec.ts';

describe('no-sleep-in-e2e', () => {
  it('reports page.waitForTimeout with its line number', () => {
    const fixture = createFixture({
      [SPEC]: [
        "test('a', async ({ page }) => {",
        '  await page.waitForTimeout(150);',
        '});',
        '',
      ].join('\n'),
    });

    const violations = runSync(noSleepInE2eRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'no-sleep-in-e2e');
    assert.equal(violations[0]?.file, SPEC);
    assert.match(violations[0]?.message ?? '', /^Line 2: a wall-clock sleep/u);
  });

  it('reports a bare setTimeout and the window / globalThis forms', () => {
    const fixture = createFixture({
      [SPEC]: [
        'await new Promise((r) => setTimeout(r, 500));',
        'window.setTimeout(done, 100);',
        'globalThis.setTimeout(done, 100);',
        '',
      ].join('\n'),
    });

    assert.equal(checkNoSleepInE2e(fixture.root).length, 3);
  });

  it('allows test.setTimeout, which is a journey budget rather than a sleep', () => {
    const fixture = createFixture({
      [SPEC]: 'test.setTimeout(180_000);\nawait expect(panel).toBeHidden();\n',
    });

    assert.deepEqual(checkNoSleepInE2e(fixture.root), []);
  });

  it('ignores a comment that merely names the banned call', () => {
    const fixture = createFixture({
      [SPEC]: '// Replaced a page.waitForTimeout(150) loop with toPass().\nexport {};\n',
    });

    assert.deepEqual(checkNoSleepInE2e(fixture.root), []);
  });

  it('covers support helpers as well as specs, and skips run artifacts', () => {
    const fixture = createFixture({
      'apps/web/e2e/support/auth.ts': 'await page.waitForTimeout(1);\n',
      'apps/web/e2e/test-results/trace.ts': 'await page.waitForTimeout(1);\n',
    });

    const violations = checkNoSleepInE2e(fixture.root);

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.file, 'apps/web/e2e/support/auth.ts');
  });

  it('looks only at the e2e suite, not at unit tests that legitimately fake timers', () => {
    const fixture = createFixture({
      'apps/web/src/lib/poll.test.ts': 'setTimeout(tick, 10);\n',
    });

    assert.deepEqual(checkNoSleepInE2e(fixture.root), []);
  });

  it('is dormant when the suite does not exist', () => {
    assert.deepEqual(checkNoSleepInE2e(createFixture().root), []);
  });
});
