import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { securitySpecRequiresControlRule } from './security-spec-requires-control';

const SPEC = 'apps/api/security-spec/example.security-spec.ts';

describe('security-spec-requires-control', () => {
  it('reports a suite whose cases are all absence assertions', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('refuses a stranger', () => {
    expect(open()).toBe(false);
  });
  it('writes no row', () => {
    expect(rows()).toHaveLength(0);
  });
});
`,
    });

    const violations = runSync(securitySpecRequiresControlRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'security-spec-requires-control');
    assert.match(violations[0]?.message ?? '', /2 case\(s\) and no `control:` case/u);
  });

  it('does not accept a control named only in a comment', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  // control: an active member gets in. Covered by the isolation lane.
  it('refuses a stranger', () => {
    expect(open()).toBe(false);
  });
});
`,
    });

    assert.equal(runSync(securitySpecRequiresControlRule, fixture.context()).length, 1);
  });

  it('does not accept a control that lives in a sibling suite', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('refuses a stranger', () => {
    expect(open()).toBe(false);
  });
});

describe('SEC-900 the lock', () => {
  it('control: the lock opens for a member', () => {
    expect(open()).toBe(true);
  });
});
`,
    });

    const violations = runSync(securitySpecRequiresControlRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /the door/u);
  });

  it('requires a control in each nested suite that owns cases', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  it('control: the door opens for a member', () => {
    expect(open()).toBe(true);
  });

  describe('when the member was removed', () => {
    it('refuses them', () => {
      expect(open()).toBe(false);
    });
  });
});
`,
    });

    const violations = runSync(securitySpecRequiresControlRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /when the member was removed/u);
  });

  it('reports a case that sits outside any describe', () => {
    const fixture = createFixture({
      [SPEC]: `it('refuses a stranger', () => {
  expect(open()).toBe(false);
});
`,
    });

    const violations = runSync(securitySpecRequiresControlRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /outside any `describe`/u);
  });

  it('accepts a grouping suite that owns no cases of its own', () => {
    const fixture = createFixture({
      [SPEC]: `describe('SEC-900 the door', () => {
  describe('linked path', () => {
    it('control: the door opens for a member', () => {
      expect(open()).toBe(true);
    });
    it('refuses a stranger', () => {
      expect(open()).toBe(false);
    });
  });
});
`,
    });

    assert.deepEqual(runSync(securitySpecRequiresControlRule, fixture.context()), []);
  });

  it('ignores specs outside the security lane', () => {
    const fixture = createFixture({
      'apps/api/src/modules/example/example.spec.ts': `describe('x', () => {
  it('has no control', () => {
    expect(1).toBe(1);
  });
});
`,
    });

    assert.deepEqual(runSync(securitySpecRequiresControlRule, fixture.context()), []);
  });
});
