import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, messages, runSync } from '../../test-support';
import { securitySpecNoSilentBailRule } from './security-spec-no-silent-bail';

const SPEC = 'apps/api/security-spec/example.security-spec.ts';

/** A file whose only case asserts, in a suite, which is the shape the rule accepts. */
const clean = `describe('SEC-900 the door', () => {
  it('control: the door opens for a member', () => {
    expect(open()).toBe(true);
  });
});
`;

describe('security-spec-no-silent-bail', () => {
  it('reports a skipped case', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it.skip('refuses a stranger', () => {
    expect(open()).toBe(false);
  });
});
`,
    });

    const violations = runSync(securitySpecNoSilentBailRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'security-spec-no-silent-bail');
    assert.match(violations[0]?.message ?? '', /`it\.skip` is not allowed/u);
  });

  it('reports xit, fit, todo and a focused describe', () => {
    const fixture = createFixture({
      [SPEC]: `xit('one', () => { expect(1).toBe(1); });
fit('two', () => { expect(1).toBe(1); });
it.todo('three');
fdescribe('four', () => { it('five', () => { expect(1).toBe(1); }); });
`,
    });

    const reported = messages(runSync(securitySpecNoSilentBailRule, fixture.context())).filter(
      (message) => /is not allowed in the security lane/u.test(message),
    );

    assert.equal(reported.length, 4);
  });

  it('reports a bare early return inside a case', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('control: refuses a stranger', () => {
    if (!process.env.DATABASE_URL) {
      return;
    }
    expect(open()).toBe(false);
  });
});
`,
    });

    const violations = runSync(securitySpecNoSilentBailRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /returns early without asserting/u);
  });

  it('does not count a return inside a nested callback as a bail', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('control: refuses a stranger', () => {
    const names = rows.map((row) => {
      return row.name;
    });
    expect(names).toEqual([]);
  });
});
`,
    });

    assert.deepEqual(runSync(securitySpecNoSilentBailRule, fixture.context()), []);
  });

  it('reports a case that asserts nothing', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('control: refuses a stranger', async () => {
    await refuse();
  });
});
`,
    });

    const violations = runSync(securitySpecNoSilentBailRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /calls no `expect`/u);
  });

  it('accepts an assertion factored into a helper NAMED expect..., and not one named otherwise', () => {
    const named = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('control: refuses a stranger', () => {
    expectRefused(open());
  });
});
`,
    });
    assert.deepEqual(runSync(securitySpecNoSilentBailRule, named.context()), []);

    const unnamed = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('control: refuses a stranger', () => {
    checkRefused(open());
  });
});
`,
    });
    const violations = runSync(securitySpecNoSilentBailRule, unnamed.context());
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /calls no `expect`/u);
  });

  it('accepts a case that returns a value, which is ordinary jest style', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('control: refuses a stranger', () => {
    return expect(refuse()).resolves.toBe(false);
  });
});
`,
    });

    assert.deepEqual(runSync(securitySpecNoSilentBailRule, fixture.context()), []);
  });

  it('passes a clean spec, and ignores files outside the security lane', () => {
    const fixture = createFixture({
      [SPEC]: clean,
      'apps/api/src/modules/example/example.spec.ts': `it.skip('elsewhere', () => {});\n`,
      'apps/api/security-spec/harness.ts': `export const bail = () => { return; };\n`,
    });

    assert.deepEqual(runSync(securitySpecNoSilentBailRule, fixture.context()), []);
  });
});
