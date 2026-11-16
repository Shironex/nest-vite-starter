import { keysOf, pickDefined } from './object';

describe('keysOf', () => {
  it('returns the keys, in insertion order', () => {
    expect(keysOf({ b: 1, a: 2 })).toEqual(['b', 'a']);
  });

  it('returns nothing for an empty object', () => {
    expect(keysOf({})).toEqual([]);
  });
});

describe('pickDefined', () => {
  it('copies only the named keys, so an extra field cannot ride along', () => {
    const source = { a: 1, b: 2, c: 3 };
    expect(pickDefined(source, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });

  /**
   * THE PROPERTY EVERY CALLER DEPENDS ON. A patch built for a partial update
   * must write a column exactly when the caller mentioned it, so an absent key
   * has to be MISSING from the result rather than present-and-undefined: the
   * second form is what a Prisma update reads as "set this to null".
   */
  it('omits an undefined value entirely rather than carrying it through', () => {
    const result = pickDefined({ a: undefined, b: 2 } as { a?: number | undefined; b: number }, [
      'a',
      'b',
    ]);
    expect(Object.hasOwn(result, 'a')).toBe(false);
    expect(result).toEqual({ b: 2 });
  });

  it('copies null through, because null is a VALUE and not an absence', () => {
    // "Set this nullable column to null" and "leave it alone" are different
    // instructions, and only the first is expressible as null.
    const result = pickDefined({ a: null } as { a: string | null }, ['a']);
    expect(Object.hasOwn(result, 'a')).toBe(true);
    expect(result.a).toBeNull();
  });

  it.each([0, '', false, Number.NaN])('copies the falsy value %p through', (value) => {
    expect(pickDefined({ a: value }, ['a'])).toEqual({ a: value });
  });

  it('returns an empty object when every named key is undefined', () => {
    const result = pickDefined(
      { a: undefined, b: undefined } as { a?: 1 | undefined; b?: 2 | undefined },
      ['a', 'b'],
    );
    expect(result).toEqual({});
  });

  it('does not mutate the source', () => {
    const source = { a: 1, b: 2 };
    pickDefined(source, ['a']);
    expect(source).toEqual({ a: 1, b: 2 });
  });
});
