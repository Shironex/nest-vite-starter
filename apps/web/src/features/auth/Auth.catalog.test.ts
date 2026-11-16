import { describe, expect, it } from 'vitest';
import en from './locales/en.json';

/**
 * The auth catalog. An empty leaf
 * renders as a blank label or button on the sign-in screen, which no type check
 * and no lint rule would catch.
 */

/** Every leaf key of a nested catalog, as `a.b.c`. */
function leafKeys(catalog: unknown, prefix = ''): string[] {
  if (typeof catalog !== 'object' || catalog === null) return [prefix];
  return Object.entries(catalog).flatMap(([key, value]) =>
    leafKeys(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/** Read a leaf out of a nested catalog by its flattened key. */
function resolve(catalog: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) => (typeof node === 'object' && node !== null ? Reflect.get(node, part) : node),
      catalog,
    );
}

describe('auth catalog', () => {
  it('leaves no key empty, which would render a blank label or button', () => {
    expect(leafKeys(en).filter((key) => resolve(en, key) === '')).toEqual([]);
  });
});
