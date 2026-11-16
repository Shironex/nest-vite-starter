import { DomainError } from './domain-error';
import { InvariantError } from './invariant-error';

describe('InvariantError', () => {
  it('is an Error with a stable name and the given message', () => {
    const error = new InvariantError('Unknown Prisma delegate: foo');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvariantError');
    expect(error.message).toBe('Unknown Prisma delegate: foo');
  });

  it('keeps the cause it wraps', () => {
    const cause = new Error('bad auth tag');

    expect(new InvariantError('Failed to decrypt', { cause }).cause).toBe(cause);
  });

  // The point of the class: a broken invariant must never be mistaken for a
  // refusal the caller can act on, so the tRPC boundary keeps mapping it to 500.
  it('is not a DomainError', () => {
    expect(new InvariantError('x')).not.toBeInstanceOf(DomainError);
  });
});
