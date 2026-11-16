import { describe, expect, it } from 'vitest';
import { TOURS, tourNameKey, tourStepKeys } from './Help.tours';
import en from './locales/en.json';

/**
 * The help catalog against the tour registry.
 *
 * WHY THIS FILE EXISTS.
 * A key missing from `en.json` shows up on screen as a bare
 * `tours.dashboard.app-help.title`, and it closes the one hole the derived-key
 * design leaves. Deriving
 * `tours.<id>.<anchor>.*` means an author cannot typo a key apart from its
 * step, but it does not stop them forgetting the copy block entirely, and
 * driver.js renders whatever string it is handed without complaining. That is
 * what the registry loop below asserts.
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

describe('help catalog', () => {
  it('leaves no key with an empty string, which renders as a silently blank popover', () => {
    expect(leafKeys(en).filter((key) => resolve(en, key) === '')).toEqual([]);
  });

  it('carries a name, a title and a body for every registered step', () => {
    for (const tour of TOURS) {
      expect(resolve(en, tourNameKey(tour))).toEqual(expect.any(String));

      for (const step of tour.steps) {
        const keys = tourStepKeys(tour, step);
        expect(resolve(en, keys.titleKey)).toEqual(expect.any(String));
        expect(resolve(en, keys.bodyKey)).toEqual(expect.any(String));
      }
    }
  });

  /**
   * The mirror assertion: copy for a tour nobody registered is dead weight that
   * reads as coverage, and a catalog nobody checks drifts.
   */
  it('carries no copy for a tour the registry does not have', () => {
    const registered = new Set(TOURS.map((tour) => tour.id));
    const documented = Object.keys(en.tours);

    expect(documented.filter((id) => !registered.has(id))).toEqual([]);
  });

  /**
   * driver.js expands `{{current}}` and `{{total}}` itself, from a raw string
   * that never goes through i18next interpolation. A translator who "fixes" the
   * braces would leave the progress line reading literally.
   */
  it('keeps the progress placeholders driver.js expands', () => {
    expect(en.controls.progress).toContain('{{current}}');
    expect(en.controls.progress).toContain('{{total}}');
  });
});
