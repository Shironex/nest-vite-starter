import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseJUnit } from './junit';
import {
  caseTitle,
  isControl,
  parseManifest,
  reconcile,
  type IManifest,
  type IManifestCase,
} from './security-manifest';

/*
 * The reconciler is tested against SYNTHETIC JUnit documents, never by running
 * the real suite. Running it would prove the suite is currently green, which is
 * the one thing this tool is not for: what has to be proved is that each drift
 * case is REPORTED, and a green suite cannot show that. Every fixture below is
 * the smallest document that exhibits one drift.
 */

const SPEC = 'security-spec/example.security-spec.ts';
const SUITE = 'group';
const CONTROL = `${SUITE} > control: the door is reachable at all`;
const CASE = `${SUITE} > the door refuses a stranger`;

interface IFixtureCase {
  readonly name: string;
  readonly status?: 'passed' | 'failed' | 'skipped' | 'errored';
  readonly message?: string;
}

/** A JUnit document shaped exactly as jest-junit writes one for this lane. */
function junit(cases: readonly IFixtureCase[], file = SPEC): string {
  const escape = (text: string): string =>
    text
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;');

  const body = cases
    .map(({ name, status = 'passed', message = '' }) => {
      const open = `    <testcase classname="${escape(SUITE)}" name="${escape(name)}" time="0.01" file="${file}">`;
      const child =
        status === 'failed'
          ? `      <failure>${escape(message)}</failure>`
          : status === 'errored'
            ? `      <error>${escape(message)}</error>`
            : status === 'skipped'
              ? '      <skipped/>'
              : '';
      return [open, child, '    </testcase>'].filter((line) => line !== '').join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites name="jest tests">',
    `  <testsuite name="example" tests="${String(cases.length)}">`,
    body,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

function manifest(
  cases: readonly IManifestCase[],
  status: IManifest['findings'][number]['status'] = 'fixed',
): IManifest {
  return {
    version: 1,
    findings: [
      {
        id: 'SEC-900',
        title: 'example',
        status,
        spec: SPEC,
        cases,
      },
    ],
  };
}

/** The happy path every drift fixture below mutates one step away from. */
const GREEN = manifest([
  { name: CONTROL, expect: 'pass' },
  { name: CASE, expect: 'pass' },
]);

const ASSERTION_FAILURE = 'expect(received).toBe(expected)\n\nExpected: 1\nReceived: 2';

const kinds = (drifts: readonly { kind: string }[]): string[] => drifts.map((drift) => drift.kind);

describe('reconcile', () => {
  it('reports nothing when every recorded case ran and matched', () => {
    const drifts = reconcile(GREEN, parseJUnit(junit([{ name: CONTROL }, { name: CASE }])));

    assert.deepEqual(drifts, []);
  });

  it('reports a case that changed outcome', () => {
    const drifts = reconcile(
      GREEN,
      parseJUnit(junit([{ name: CONTROL }, { name: CASE, status: 'failed', message: 'boom' }])),
    );

    assert.deepEqual(kinds(drifts), ['outcome-drift']);
    assert.equal(drifts[0]?.case, CASE);
    assert.match(drifts[0]?.message ?? '', /regression of the finding/u);
  });

  it('reports a case that stopped running', () => {
    const drifts = reconcile(GREEN, parseJUnit(junit([{ name: CONTROL }])));

    assert.deepEqual(kinds(drifts), ['not-run']);
    assert.equal(drifts[0]?.case, CASE);
  });

  it('reports a case that ran but is listed nowhere', () => {
    const drifts = reconcile(
      GREEN,
      parseJUnit(junit([{ name: CONTROL }, { name: CASE }, { name: `${SUITE} > a new case` }])),
    );

    assert.deepEqual(kinds(drifts), ['unlisted']);
    assert.equal(drifts[0]?.case, `${SUITE} > a new case`);
  });

  it('reports the same case running twice', () => {
    const drifts = reconcile(
      GREEN,
      parseJUnit(junit([{ name: CONTROL }, { name: CASE }, { name: CASE }])),
    );

    assert.deepEqual(kinds(drifts), ['duplicate-result']);
    assert.match(drifts[0]?.message ?? '', /2 times/u);
  });

  it('reports the manifest listing the same case twice', () => {
    const drifts = reconcile(
      manifest([
        { name: CONTROL, expect: 'pass' },
        { name: CASE, expect: 'pass' },
        { name: CASE, expect: 'pass' },
      ]),
      parseJUnit(junit([{ name: CONTROL }, { name: CASE }])),
    );

    assert.deepEqual(kinds(drifts), ['duplicate-entry']);
  });

  it('reports a skipped case instead of treating it as passing', () => {
    const drifts = reconcile(
      GREEN,
      parseJUnit(junit([{ name: CONTROL }, { name: CASE, status: 'skipped' }])),
    );

    assert.deepEqual(kinds(drifts), ['skipped']);
  });

  it('reports a failing control, and says the file is not evidence', () => {
    const drifts = reconcile(
      GREEN,
      parseJUnit(
        junit([{ name: CONTROL, status: 'failed', message: ASSERTION_FAILURE }, { name: CASE }]),
      ),
    );

    assert.deepEqual(kinds(drifts), ['failing-control']);
    assert.match(drifts[0]?.message ?? '', /nothing else in this file is evidence/u);
  });

  it('reports a finding with no control at all', () => {
    const drifts = reconcile(
      manifest([{ name: CASE, expect: 'pass' }]),
      parseJUnit(junit([{ name: CASE }])),
    );

    assert.deepEqual(kinds(drifts), ['missing-control']);
    assert.equal(drifts[0]?.finding, 'SEC-900');
  });

  it('counts an infrastructure failure as blocked, never as evidence', () => {
    const drifts = reconcile(
      manifest(
        [
          { name: CONTROL, expect: 'pass' },
          { name: CASE, expect: 'fail' },
        ],
        'proven',
      ),
      parseJUnit(
        junit([
          { name: CONTROL },
          { name: CASE, status: 'failed', message: 'Error: SPEC-INFRA: Postgres is not reachable' },
        ]),
      ),
    );

    assert.deepEqual(kinds(drifts), ['blocked']);
    assert.match(drifts[0]?.message ?? '', /Blocked before it could assert/u);
  });

  it('counts a suite-level error as blocked', () => {
    const drifts = reconcile(
      GREEN,
      parseJUnit(
        junit([
          { name: CONTROL },
          { name: CASE, status: 'errored', message: 'Cannot find module' },
        ]),
      ),
    );

    assert.deepEqual(kinds(drifts), ['blocked']);
  });

  it('reports an expected-red case that failed on a throw rather than an assertion', () => {
    const drifts = reconcile(
      manifest(
        [
          { name: CONTROL, expect: 'pass' },
          { name: CASE, expect: 'fail' },
        ],
        'proven',
      ),
      parseJUnit(
        junit([
          { name: CONTROL },
          {
            name: CASE,
            status: 'failed',
            message: 'TypeError: Cannot read properties of undefined',
          },
        ]),
      ),
    );

    assert.deepEqual(kinds(drifts), ['not-an-assertion']);
  });

  it('accepts an expected-red case that failed on a real assertion', () => {
    const drifts = reconcile(
      manifest(
        [
          { name: CONTROL, expect: 'pass' },
          { name: CASE, expect: 'fail' },
        ],
        'proven',
      ),
      parseJUnit(
        junit([{ name: CONTROL }, { name: CASE, status: 'failed', message: ASSERTION_FAILURE }]),
      ),
    );

    assert.deepEqual(drifts, []);
  });

  it('reports an expected-red case that went green, so a fix cannot land unrecorded', () => {
    const drifts = reconcile(
      manifest(
        [
          { name: CONTROL, expect: 'pass' },
          { name: CASE, expect: 'fail' },
        ],
        'proven',
      ),
      parseJUnit(junit([{ name: CONTROL }, { name: CASE }])),
    );

    assert.deepEqual(kinds(drifts), ['outcome-drift']);
    assert.match(drifts[0]?.message ?? '', /Recorded as expected to fail, but it passed/u);
  });

  it('reports a status that disagrees with its cases, in both directions', () => {
    const fixedButRed = reconcile(
      manifest([
        { name: CONTROL, expect: 'pass' },
        { name: CASE, expect: 'fail' },
      ]),
      parseJUnit(
        junit([{ name: CONTROL }, { name: CASE, status: 'failed', message: ASSERTION_FAILURE }]),
      ),
    );
    assert.deepEqual(kinds(fixedButRed), ['status-drift']);

    const provenButGreen = reconcile(
      manifest(
        [
          { name: CONTROL, expect: 'pass' },
          { name: CASE, expect: 'pass' },
        ],
        'proven',
      ),
      parseJUnit(junit([{ name: CONTROL }, { name: CASE }])),
    );
    assert.deepEqual(kinds(provenButGreen), ['status-drift']);
  });

  it('reports a control the manifest records as expected to fail', () => {
    const drifts = reconcile(
      manifest(
        [
          { name: CONTROL, expect: 'fail' },
          { name: CASE, expect: 'pass' },
        ],
        'proven',
      ),
      parseJUnit(
        junit([{ name: CONTROL, status: 'failed', message: ASSERTION_FAILURE }, { name: CASE }]),
      ),
    );

    assert.equal(kinds(drifts).includes('failing-control'), true);
    assert.match(drifts[0]?.message ?? '', /always expected to pass/u);
  });

  it('keys a case on its file, so the same name in another spec is a different case', () => {
    const drifts = reconcile(
      GREEN,
      parseJUnit(
        junit([{ name: CONTROL }, { name: CASE }], 'security-spec/other.security-spec.ts'),
      ),
    );

    assert.deepEqual(kinds(drifts), ['not-run', 'not-run', 'unlisted', 'unlisted']);
  });

  it('reports every recorded case as not-run when the report is empty', () => {
    const drifts = reconcile(GREEN, []);

    assert.deepEqual(kinds(drifts), ['not-run', 'not-run']);
  });
});

describe('parseJUnit', () => {
  it('decodes the entities jest-junit escapes into a case name', () => {
    const name = `${SUITE} > refuses "a & b" > c`;
    const [only] = parseJUnit(junit([{ name }]));

    assert.equal(only?.name, name);
    assert.equal(only?.file, SPEC);
    assert.equal(only?.status, 'passed');
  });

  it('reads a self-closing skipped case and a failure body', () => {
    const parsed = parseJUnit(
      junit([
        { name: CONTROL, status: 'skipped' },
        { name: CASE, status: 'failed', message: 'expect(received).toBe(1)' },
      ]),
    );

    assert.equal(parsed[0]?.status, 'skipped');
    assert.equal(parsed[1]?.status, 'failed');
    assert.deepEqual(parsed[1]?.messages, ['expect(received).toBe(1)']);
  });
});

describe('caseTitle / isControl', () => {
  it('reads the title out of the describe chain', () => {
    assert.equal(caseTitle('outer > inner > control: something'), 'control: something');
    assert.equal(caseTitle('no chain'), 'no chain');
  });

  it('counts a control only when the TITLE says so, not an ancestor', () => {
    assert.equal(isControl('outer > control: it works'), true);
    assert.equal(isControl('control: outer > it works'), false);
  });
});

describe('parseManifest', () => {
  it('accepts a well-formed document', () => {
    const parsed = parseManifest(JSON.stringify(GREEN));

    assert.equal(parsed.findings.length, 1);
    assert.equal(parsed.findings[0]?.cases.length, 2);
  });

  it('refuses a finding with an unknown status', () => {
    const broken = JSON.stringify({
      version: 1,
      findings: [{ ...GREEN.findings[0], status: 'maybe' }],
    });

    assert.throws(() => parseManifest(broken), /status must be one of/u);
  });

  it('refuses a spec path that is not a security spec', () => {
    const broken = JSON.stringify({
      version: 1,
      findings: [{ ...GREEN.findings[0], spec: 'src/thing.spec.ts' }],
    });

    assert.throws(() => parseManifest(broken), /security-spec\.ts/u);
  });

  it('refuses two findings with the same id', () => {
    const broken = JSON.stringify({
      version: 1,
      findings: [GREEN.findings[0], GREEN.findings[0]],
    });

    assert.throws(() => parseManifest(broken), /used twice/u);
  });

  it('refuses a case with an unknown expected outcome', () => {
    const broken = JSON.stringify({
      version: 1,
      findings: [{ ...GREEN.findings[0], cases: [{ name: CASE, expect: 'maybe' }] }],
    });

    assert.throws(() => parseManifest(broken), /expect must be/u);
  });
});
