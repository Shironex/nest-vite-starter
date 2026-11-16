import { describe, expect, it } from 'vitest';
import { changedFieldNames, diffSnapshots, formatDiffValue, metadataEntries } from './Audit.diff';

describe('formatDiffValue', () => {
  it('maps null and undefined to the empty marker', () => {
    expect(formatDiffValue(null)).toBeNull();
    expect(formatDiffValue(undefined)).toBeNull();
  });

  it('renders primitives directly and structures as compact JSON', () => {
    expect(formatDiffValue('8%')).toBe('8%');
    expect(formatDiffValue(14)).toBe('14');
    expect(formatDiffValue(false)).toBe('false');
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
    expect(formatDiffValue([1, 2])).toBe('[1,2]');
  });
});

describe('diffSnapshots', () => {
  it('keeps only the fields that actually changed', () => {
    const changes = diffSnapshots(
      { vat: '8%', term: '14 days', city: 'Boston' },
      { vat: '23%', term: '14 days', city: 'Boston' },
    );
    expect(changes).toEqual([{ field: 'vat', before: '8%', after: '23%' }]);
  });

  it('handles one-sided snapshots (creation and deletion shapes)', () => {
    expect(diffSnapshots(null, { name: 'NORTHWIND' })).toEqual([
      { field: 'name', before: null, after: 'NORTHWIND' },
    ]);
    expect(diffSnapshots({ name: 'skan.pdf' }, null)).toEqual([
      { field: 'name', before: 'skan.pdf', after: null },
    ]);
  });

  it('returns no changes when neither side is snapshot-shaped', () => {
    expect(diffSnapshots(null, null)).toEqual([]);
    expect(diffSnapshots('legacy', 42)).toEqual([]);
  });

  it('sorts fields so the rendering is stable', () => {
    const changes = diffSnapshots({ b: 1, a: 1 }, { b: 2, a: 2 });
    expect(changes.map((change) => change.field)).toEqual(['a', 'b']);
  });
});

describe('changedFieldNames', () => {
  it('reads the field-name list some writers record', () => {
    expect(changedFieldNames({ fields: ['city', 'phone'] })).toEqual(['city', 'phone']);
  });

  it('ignores non-list and non-string shapes instead of crashing the row', () => {
    expect(changedFieldNames({ fields: 'city' })).toEqual([]);
    expect(changedFieldNames({ fields: ['city', 7] })).toEqual(['city']);
    expect(changedFieldNames(null)).toEqual([]);
  });
});

describe('metadataEntries', () => {
  it('surfaces metadata pairs minus the keys rendered elsewhere', () => {
    expect(metadataEntries({ reason: 'bad_password', fields: ['x'], count: 2 })).toEqual([
      { key: 'reason', value: 'bad_password' },
      { key: 'count', value: '2' },
    ]);
  });

  it('returns nothing for non-record metadata', () => {
    expect(metadataEntries(null)).toEqual([]);
    expect(metadataEntries('legacy')).toEqual([]);
  });
});
