import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commonStrings } from '@/lib/strings';
import { NAV_GROUPS, findNavItemForPath, isActivePath } from './Layout.nav';

describe('isActivePath', () => {
  it('matches the route exactly', () => {
    expect(isActivePath('/workspaces', '/workspaces')).toBe(true);
  });

  it('matches a nested route', () => {
    expect(isActivePath('/workspaces/f-1', '/workspaces')).toBe(true);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    expect(isActivePath('/workspaces-archive', '/workspaces')).toBe(false);
  });

  it('does not match an unrelated route', () => {
    expect(isActivePath('/compliance/settings', '/settings')).toBe(false);
  });
});

describe('findNavItemForPath', () => {
  it('finds the entry owning the route', () => {
    expect(findNavItemForPath('/workspaces/f-1')?.href).toBe('/workspaces');
  });

  it('returns null outside the nav', () => {
    expect(findNavItemForPath('/auth/two-factor')).toBeNull();
  });

  it('prefers the deepest match when two entries overlap', () => {
    const groups = [
      {
        label: 'g',
        items: [
          { title: 'a', pageTitle: 'a', href: '/x', icon: () => null },
          { title: 'b', pageTitle: 'b', href: '/x/y', icon: () => null },
        ],
      },
    ];
    expect(findNavItemForPath('/x/y', groups)?.href).toBe('/x/y');
  });
});

describe('NAV_GROUPS', () => {
  it('ships no entry without a destination', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    expect(items.every((item) => item.href.startsWith('/'))).toBe(true);
    expect(items.some((item) => item.href === '#')).toBe(false);
  });

  /**
   * `workspaces.list` is open to every staff account; only `workspaces.create` and
   * `workspaces.update` carry `AdminMiddleware`, and the screen hides those itself.
   * Gating the link would hide the list from accounts the server lets read it.
   */
  it('leaves the Workspaces screen open to every staff account', () => {
    const workspaces = NAV_GROUPS.flatMap((group) => group.items).find(
      (item) => item.href === '/workspaces',
    );

    expect(workspaces).toBeDefined();
    expect(workspaces?.role).toBeUndefined();
  });

  /**
   * Every `pageTitle.*` entry is reached from exactly two places: a nav item's
   * `pageTitle` here (the topbar heading) and a route's `head()` (the document
   * title). An entry reached from neither is dead on arrival, which is what this
   * assertion catches.
   */
  it('reaches every page title from the nav or a route', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    const used = new Set(
      Object.entries(commonStrings.pageTitle)
        .filter(([, text]) => items.some((item) => item.pageTitle === text))
        .map(([key]) => key),
    );

    // Routes outside the nav (every /auth screen) still need
    // a document title, so the second reader is scanned from source.
    for (const key of routeHeadKeys()) used.add(key);

    expect(Object.keys(commonStrings.pageTitle).sort()).toEqual([...used].sort());
  });
});

/** Every `commonStrings.pageTitle.<key>` a route hands to `pageTitle()` in its `head()`. */
function routeHeadKeys(): string[] {
  const routesDir = join(import.meta.dirname, '..', '..', 'routes');
  const keys: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
        for (const match of readFileSync(path, 'utf8').matchAll(
          /pageTitle\(commonStrings\.pageTitle\.(\w+)\)/gu,
        )) {
          keys.push(match[1] as string);
        }
      }
    }
  };

  walk(routesDir);
  return keys;
}
