import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
        labelKey: 'g',
        items: [
          { titleKey: 'a', pageTitleKey: 'a', href: '/x', icon: () => null },
          { titleKey: 'b', pageTitleKey: 'b', href: '/x/y', icon: () => null },
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
   * Every `pageTitle.*` in the catalog is reached from exactly two places: a
   * `pageTitleKey` here (the topbar heading) and a route's `head()` (the
   * document title). An entry added without its key renders a bare key in the
   * topbar; a key reached from neither is dead on arrival. This is the
   * assertion that keeps all three in step.
   */
  it('keys every entry to a title the catalog actually carries', async () => {
    const { default: en } = await import('@/lib/i18n/locales/en.json');
    const items = NAV_GROUPS.flatMap((group) => group.items);
    const used = new Set(items.map((item) => item.pageTitleKey.replace('pageTitle.', '')));

    for (const item of items) {
      const key = item.titleKey.replace('nav.', '');
      const title = item.pageTitleKey.replace('pageTitle.', '');
      expect(en.common.nav).toHaveProperty(key);
      expect(en.common.pageTitle).toHaveProperty(title);
    }

    // Routes outside the nav (every /auth screen) still need
    // a document title, so the second reader is scanned from source.
    for (const key of routeHeadKeys()) used.add(key);

    expect(Object.keys(en.common.pageTitle).sort()).toEqual([...used].sort());
  });
});

/** Every `pageTitle.<key>` a route hands to `pageTitle()` in its `head()`. */
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
          /pageTitle\('pageTitle\.(\w+)'\)/gu,
        )) {
          keys.push(match[1] as string);
        }
      }
    }
  };

  walk(routesDir);
  return keys;
}
