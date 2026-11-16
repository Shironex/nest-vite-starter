import { errorMessage, errorStack, toError } from './error';

/**
 * These three exist to stop the same failure reading three different ways
 * depending on which module caught it, so the cases that matter are the ones a
 * `catch` can actually be handed: not just an Error.
 */
describe('errorMessage', () => {
  it('reads an Error message', () => {
    expect(errorMessage(new Error('S3 unavailable'))).toBe('S3 unavailable');
  });

  it('reads a subclass message, so a domain error is not flattened to its class', () => {
    class TimeoutError extends Error {}
    expect(errorMessage(new TimeoutError('took too long'))).toBe('took too long');
  });

  it.each([
    ['a thrown string', 'plain string', 'plain string'],
    ['a thrown number', 42, '42'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
  ])('prints %s rather than a fixed word', (_label, thrown, expected) => {
    // `String(...)` is strictly more information than 'unknown', and it says
    // something useful even for a rejection with nothing in it.
    expect(errorMessage(thrown)).toBe(expected);
  });

  it('never throws on an object with a hostile toString', () => {
    expect(() => errorMessage({ toString: () => 'weird' })).not.toThrow();
  });
});

describe('errorStack', () => {
  it('returns the trace, which is what logger.error wants as its second argument', () => {
    const error = new Error('boom');
    expect(errorStack(error)).toBe(error.stack);
    expect(errorStack(error)).toContain('boom');
  });

  it('returns undefined for an Error carrying no stack, not a placeholder', () => {
    const error = new Error('no trace');
    delete error.stack;
    // Nest reads undefined as "no trace available"; a string would print a
    // fake one.
    expect(errorStack(error)).toBeUndefined();
  });

  it('falls back to the printed value for a non-Error', () => {
    expect(errorStack('just a string')).toBe('just a string');
  });
});

describe('toError', () => {
  it('passes an Error through unchanged, so the original stack survives', () => {
    const error = new Error('original');
    expect(toError(error)).toBe(error);
  });

  it('wraps a non-Error while KEEPING its text', () => {
    const wrapped = toError('a rejected string');
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('a rejected string');
  });
});
