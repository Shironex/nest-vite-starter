import { describe, expect, it } from 'vitest';
import { toApiPath } from './api-path';

describe('toApiPath', () => {
  it('returns a same-origin api path unchanged', () => {
    expect(toApiPath('/api/files/download/abc123?x=1')).toBe('/api/files/download/abc123?x=1');
  });

  it.each([
    ['a scheme-relative path', '//evil.example/x'],
    ['an absolute URL', 'https://evil.example/x'],
    ['a userinfo-shaped path', '@evil.example/x'],
    ['a relative path with no leading slash', 'api/x'],
    ['a backslash the browser reads as a slash', '/\\evil.example/x'],
    ['an embedded newline', '/api/x\nLocation: https://evil.example'],
    ['an embedded space', '/api/x y'],
    ['an empty string', ''],
  ])('refuses %s', (_label, url) => {
    expect(() => toApiPath(url)).toThrow('Refusing a non-relative api path');
  });
});
