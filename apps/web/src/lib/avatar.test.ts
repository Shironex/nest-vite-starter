import { describe, it, expect } from 'vitest';
import { getInitials, getDownloadUrlFromResult, isHttpUrl } from '@/lib/avatar';

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

describe('getDownloadUrlFromResult', () => {
  it('returns the downloadUrl string when present', () => {
    expect(getDownloadUrlFromResult({ downloadUrl: 'https://example.com/file.png' })).toBe(
      'https://example.com/file.png',
    );
  });

  it('returns undefined for null input', () => {
    expect(getDownloadUrlFromResult(null)).toBeUndefined();
  });

  it('returns undefined for non-object input', () => {
    expect(getDownloadUrlFromResult('string')).toBeUndefined();
  });

  it('returns undefined when downloadUrl is missing', () => {
    expect(getDownloadUrlFromResult({ otherKey: 'value' })).toBeUndefined();
  });

  it('returns undefined when downloadUrl is not a string', () => {
    expect(getDownloadUrlFromResult({ downloadUrl: 123 })).toBeUndefined();
  });
});

describe('isHttpUrl', () => {
  it('returns true for http URLs', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
  });

  it('returns true for https URLs', () => {
    expect(isHttpUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('returns false for ftp URLs', () => {
    expect(isHttpUrl('ftp://files.example.com')).toBe(false);
  });

  it('returns false for non-URL strings', () => {
    expect(isHttpUrl('not-a-url')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isHttpUrl('')).toBe(false);
  });

  it('returns false for relative paths', () => {
    expect(isHttpUrl('/uploads/avatar.png')).toBe(false);
  });
});
