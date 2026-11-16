import { describe, expect, it } from 'vitest';
import { commonStrings, errorStrings, labelFor } from './strings';

describe('labelFor', () => {
  it('returns the table entry for a known key', () => {
    expect(labelFor(commonStrings.actions, 'save')).toBe(commonStrings.actions.save);
  });

  it('falls back to the key, or to the given fallback, for an unknown one', () => {
    expect(labelFor(commonStrings.actions, 'nope')).toBe('nope');
    expect(labelFor(commonStrings.actions, 'nope', 'raw.value')).toBe('raw.value');
  });

  it('does not resolve inherited object keys', () => {
    expect(labelFor(commonStrings.actions, 'toString')).toBe('toString');
  });
});

describe('errorStrings', () => {
  it('carries a non-empty sentence for every code', () => {
    for (const sentence of Object.values(errorStrings)) {
      expect(sentence.trim()).not.toBe('');
    }
  });
});
