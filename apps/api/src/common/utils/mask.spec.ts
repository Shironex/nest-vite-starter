import { maskTail } from './mask';

describe('maskTail', () => {
  it('keeps only the requested tail, preserving length', () => {
    expect(maskTail('44051401359', 2)).toBe('•••••••••59');
    expect(maskTail('PL61109010140000071219812874', 4)).toBe('••••••••••••••••••••••••2874');
  });

  it('masks everything when the value is no longer than the tail', () => {
    expect(maskTail('59', 2)).toBe('••');
    expect(maskTail('5', 2)).toBe('•');
  });

  it('masks everything for a zero tail', () => {
    expect(maskTail('KP-123', 0)).toBe('••••••');
  });
});
