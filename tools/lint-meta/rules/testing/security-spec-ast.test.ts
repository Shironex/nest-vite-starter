import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture } from '../../test-support';
import {
  callsExpect,
  collectSecuritySpecs,
  flatten,
  isControlTitle,
  readSuites,
  ts,
  visitOwnBody,
} from './security-spec-ast';

const SPEC_DIR = 'apps/api/security-spec';
const FILE = `${SPEC_DIR}/a-01.security-spec.ts`;

/** The callback body of the one case a fixture declares, for the body-level helpers. */
function onlyCaseBody(source: string): ts.Node {
  const node = flatten(readSuites(FILE, source)).find((entry) => entry.kind === 'case');
  const body = node?.body;
  assert.ok(body, 'fixture must declare exactly one case with a callback');
  return body;
}

describe('collectSecuritySpecs', () => {
  it('collects every spec under the lane, sorted, with repo-relative paths', () => {
    const fixture = createFixture({
      [`${SPEC_DIR}/b-02.security-spec.ts`]: 'export const b = 2;\n',
      [`${SPEC_DIR}/a-01.security-spec.ts`]: 'export const a = 1;\n',
      [`${SPEC_DIR}/nested/c-03.security-spec.ts`]: 'export const c = 3;\n',
      [`${SPEC_DIR}/README.md`]: '# not a spec\n',
      [`${SPEC_DIR}/helpers.ts`]: 'export const helper = 1;\n',
      'apps/api/src/a.security-spec.ts': 'export const outside = 1;\n',
    });

    assert.deepEqual(collectSecuritySpecs(fixture.root), [
      { file: `${SPEC_DIR}/a-01.security-spec.ts`, source: 'export const a = 1;\n' },
      { file: `${SPEC_DIR}/b-02.security-spec.ts`, source: 'export const b = 2;\n' },
      { file: `${SPEC_DIR}/nested/c-03.security-spec.ts`, source: 'export const c = 3;\n' },
    ]);
  });

  it('skips the junit output directory and dependency trees', () => {
    const fixture = createFixture({
      [`${SPEC_DIR}/.junit/old.security-spec.ts`]: 'export const stale = 1;\n',
      [`${SPEC_DIR}/node_modules/p/x.security-spec.ts`]: 'export const dep = 1;\n',
    });

    assert.deepEqual(collectSecuritySpecs(fixture.root), []);
  });

  it('is dormant when the lane does not exist', () => {
    assert.deepEqual(collectSecuritySpecs(createFixture().root), []);
  });
});

describe('readSuites', () => {
  it('nests cases under the suite whose callback they sit in', () => {
    const [outer, ...rest] = readSuites(
      FILE,
      `
describe('outer', () => {
  it('a', () => {});
  describe('inner', () => {
    it('b', () => {});
  });
});
`,
    );

    assert.deepEqual(rest, []);
    assert.equal(outer?.kind, 'suite');
    assert.equal(outer?.title, 'outer');
    assert.deepEqual(
      outer?.children.map((child) => [child.kind, child.title]),
      [
        ['case', 'a'],
        ['suite', 'inner'],
      ],
    );
    assert.deepEqual(
      outer?.children[1]?.children.map((child) => child.title),
      ['b'],
    );
  });

  it('keeps the callee as written, so a skipped or focused case is visible', () => {
    const nodes = flatten(
      readSuites(
        FILE,
        `
xdescribe('skipped suite', () => {
  it.skip('skipped', () => {});
  xit('also skipped', () => {});
  fit('focused', () => {});
});
`,
      ),
    );

    assert.deepEqual(
      nodes.map((node) => node.callee),
      ['xdescribe', 'it.skip', 'xit', 'fit'],
    );
  });

  it('counts `it.each(rows)(...)` once, on the call that carries the title', () => {
    const cases = flatten(readSuites(FILE, "it.each(rows)('case %s', () => {});\n")).filter(
      (node) => node.kind === 'case',
    );

    assert.deepEqual(
      cases.map((node) => [node.callee, node.title]),
      [['it.each', 'case %s']],
    );
  });

  it('reports a computed title as null rather than as text', () => {
    const [node] = readSuites(FILE, 'it(`case ${name}`, () => {});\n');

    assert.equal(node?.title, null);
  });

  it('records the 1-based line and ignores calls that are not suites or cases', () => {
    const nodes = readSuites(FILE, ['beforeEach(() => {});', "it('a', () => {});", ''].join('\n'));

    assert.equal(nodes.length, 1);
    assert.equal(nodes[0]?.line, 2);
  });
});

describe('isControlTitle', () => {
  it('accepts a `control:` prefix regardless of case and leading space', () => {
    assert.equal(isControlTitle('control: the guard refuses'), true);
    assert.equal(isControlTitle('  Control: the guard refuses'), true);
  });

  it('rejects a title that only mentions a control, and a computed one', () => {
    assert.equal(isControlTitle('has a control: somewhere'), false);
    assert.equal(isControlTitle(null), false);
  });
});

describe('visitOwnBody', () => {
  it('sees a return in the case body but not one inside a nested callback', () => {
    const count = (body: ts.Node): number => {
      let seen = 0;
      visitOwnBody(body, (child) => {
        if (ts.isReturnStatement(child)) seen += 1;
      });
      return seen;
    };

    assert.equal(count(onlyCaseBody("it('a', () => {\n  if (x) return;\n});\n")), 1);
    assert.equal(
      count(onlyCaseBody("it('a', () => {\n  rows.map(() => {\n    return 1;\n  });\n});\n")),
      0,
    );
  });
});

describe('callsExpect', () => {
  it('finds expect() nested inside a callback', () => {
    const body = onlyCaseBody(
      "it('a', () => {\n  rows.forEach(() => {\n    expect(1).toBe(1);\n  });\n});\n",
    );

    assert.equal(callsExpect(body), true);
  });

  it('accepts a helper whose name starts with expect, and only that', () => {
    const named = onlyCaseBody("it('a', () => {\n  expectRefused(result);\n});\n");
    const opaque = onlyCaseBody("it('a', () => {\n  check(result);\n});\n");

    assert.equal(callsExpect(named), true);
    assert.equal(callsExpect(opaque), false);
  });
});
