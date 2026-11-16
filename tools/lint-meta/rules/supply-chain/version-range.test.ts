import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareVersions,
  parseRange,
  parseVersion,
  satisfies,
  splitOverrideKey,
  targetLowerBound,
} from './version-range';

function inRange(version: string, selector: string): boolean {
  const parsed = parseVersion(version);
  const range = parseRange(selector);
  assert.ok(parsed !== null, `unparseable version ${version}`);
  assert.ok(range !== null, `unparseable selector ${selector}`);
  return satisfies(parsed, range);
}

describe('version-range', () => {
  it('parses a release and a prerelease, and rejects anything else', () => {
    assert.deepEqual(parseVersion('7.5.21'), {
      major: 7,
      minor: 5,
      patch: 21,
      prerelease: [],
    });
    assert.deepEqual(parseVersion('2.0.0-alpha.1')?.prerelease, ['alpha', '1']);
    assert.equal(parseVersion('workspace:*'), null);
    assert.equal(parseVersion('^1.2.3'), null);
    assert.equal(parseVersion('1.2'), null);
  });

  it('orders by triple, then puts a prerelease below its own release', () => {
    const order = ['1.0.0-alpha.1', '1.0.0-alpha.2', '1.0.0-beta', '1.0.0', '1.0.1', '1.1.0'];

    for (let index = 1; index < order.length; index += 1) {
      const lower = parseVersion(order[index - 1] ?? '');
      const higher = parseVersion(order[index] ?? '');
      assert.ok(lower !== null && higher !== null);
      assert.ok(
        compareVersions(lower, higher) < 0,
        `${order[index - 1] ?? ''} should sort below ${order[index] ?? ''}`,
      );
    }
  });

  it('matches the selector shapes the override block actually uses', () => {
    assert.equal(inRange('7.5.20', '<7.5.21'), true);
    assert.equal(inRange('7.5.21', '<7.5.21'), false);
    assert.equal(inRange('9.6.0', '<=9.6.0'), true);
    assert.equal(inRange('9.7.0', '<=9.6.0'), false);
    assert.equal(inRange('2.1.3', '>=2.0.0 <2.1.4'), true);
    assert.equal(inRange('2.1.4', '>=2.0.0 <2.1.4'), false);
    // The lower bound is what keeps the 1.x copy of brace-expansion, and the
    // 7.x copy of ws, out of a selector written for a different major line.
    assert.equal(inRange('1.1.18', '>=2.0.0 <2.1.4'), false);
    assert.equal(inRange('10.2.1', '>=10.1.1 <=10.2.1'), true);
    assert.equal(inRange('10.3.1', '>=10.1.1 <=10.2.1'), false);
    assert.equal(inRange('3.2.0', '=3.2.0'), true);
    assert.equal(inRange('3.2.1', '=3.2.0'), false);
  });

  it('refuses a selector it cannot read rather than matching nothing', () => {
    assert.equal(parseRange('^1.2.3'), null);
    assert.equal(parseRange('>=1.0.0 || <2.0.0'), null);
    assert.equal(parseRange('   '), null);
  });

  it('reads the lowest version a target can ever install', () => {
    assert.deepEqual(targetLowerBound('^7.5.21'), parseVersion('7.5.21'));
    assert.deepEqual(targetLowerBound('~0.2.6'), parseVersion('0.2.6'));
    assert.deepEqual(targetLowerBound('>=11.1.18'), parseVersion('11.1.18'));
    assert.deepEqual(targetLowerBound('7.5.20'), parseVersion('7.5.20'));
    assert.equal(targetLowerBound('workspace:*'), null);
  });

  it('splits an override key without mistaking a scope for a selector', () => {
    assert.deepEqual(splitOverrideKey('react'), { name: 'react', selector: null });
    assert.deepEqual(splitOverrideKey('@nestjs/common'), {
      name: '@nestjs/common',
      selector: null,
    });
    assert.deepEqual(splitOverrideKey('tar@<7.5.21'), { name: 'tar', selector: '<7.5.21' });
    assert.deepEqual(splitOverrideKey('@xmldom/xmldom@<0.8.15'), {
      name: '@xmldom/xmldom',
      selector: '<0.8.15',
    });
    assert.deepEqual(splitOverrideKey('brace-expansion@>=2.0.0 <2.1.4'), {
      name: 'brace-expansion',
      selector: '>=2.0.0 <2.1.4',
    });
  });
});
