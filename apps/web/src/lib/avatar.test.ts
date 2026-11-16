import { describe, it, expect } from 'vitest';
import { getInitials } from '@/lib/avatar';

describe('getInitials', () => {
  it('returns first letters of first and last name', () => {
    expect(getInitials('John Doe', 'john@example.com')).toBe('JD');
  });

  it('returns first letters of multi-word names (capped at 2)', () => {
    expect(getInitials('John Michael Doe', 'john@example.com')).toBe('JM');
  });

  it('returns first two letters for single-word name', () => {
    expect(getInitials('Admin', 'admin@example.com')).toBe('AD');
  });

  it('uppercases the initials', () => {
    expect(getInitials('jane doe', 'jane@example.com')).toBe('JD');
  });

  it('falls back to first two chars of email when name is null', () => {
    expect(getInitials(null, 'alice@example.com')).toBe('AL');
  });

  it('falls back to first two chars of email when name is empty string', () => {
    expect(getInitials('', 'bob@example.com')).toBe('BO');
  });

  it('handles email starting with a number', () => {
    expect(getInitials(null, '123@example.com')).toBe('12');
  });
});
