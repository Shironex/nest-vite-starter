import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_COLOR_THEME } from '@repo/ui/theme';

vi.mock('@/lib/theme', () => ({
  applyTheme: vi.fn(),
  applyColorTheme: vi.fn(),
}));

import { useUIStore, migrateUIStore } from '@/stores/ui-store';

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState(useUIStore.getInitialState());
  });

  describe('initial state', () => {
    it('defaults theme to system', () => {
      expect(useUIStore.getState().theme).toBe('system');
    });

    it('defaults colorTheme to the brand default rather than a hardcoded id', () => {
      expect(useUIStore.getState().colorTheme).toBe(DEFAULT_COLOR_THEME);
    });

    it('defaults sidebarCollapsed to false', () => {
      expect(useUIStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('setTheme', () => {
    it('updates theme to dark', () => {
      useUIStore.getState().setTheme('dark');
      expect(useUIStore.getState().theme).toBe('dark');
    });

    it('updates theme to light', () => {
      useUIStore.getState().setTheme('light');
      expect(useUIStore.getState().theme).toBe('light');
    });

    it('updates theme back to system', () => {
      useUIStore.getState().setTheme('dark');
      useUIStore.getState().setTheme('system');
      expect(useUIStore.getState().theme).toBe('system');
    });

    it('calls applyTheme with the new theme', async () => {
      const { applyTheme } = await import('@/lib/theme');
      vi.mocked(applyTheme).mockClear();

      useUIStore.getState().setTheme('dark');
      expect(applyTheme).toHaveBeenCalledWith('dark');
    });
  });

  describe('setSidebarCollapsed', () => {
    it('sets sidebar to collapsed', () => {
      useUIStore.getState().setSidebarCollapsed(true);
      expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    });

    it('sets sidebar to expanded', () => {
      useUIStore.getState().setSidebarCollapsed(true);
      useUIStore.getState().setSidebarCollapsed(false);
      expect(useUIStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('toggleSidebar', () => {
    it('toggles from false to true', () => {
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    });

    it('toggles from true to false', () => {
      useUIStore.getState().setSidebarCollapsed(true);
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarCollapsed).toBe(false);
    });

    it('toggles multiple times correctly', () => {
      useUIStore.getState().toggleSidebar();
      useUIStore.getState().toggleSidebar();
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    });
  });
});

/**
 * Before SaaS Starter became the default, 'violet' was BOTH the value the store
 * seeded itself with and the sentinel meaning "this user never picked a theme",
 * so every profile that has ever loaded the app has a literal 'violet' stored
 * under `ui-store`. Without this migration, flipping the default would pin all
 * of those existing users to the old palette while only brand new profiles got
 * SaaS Starter, which is the exact opposite of the intent.
 */
describe('migrateUIStore', () => {
  it('rewrites a v0 stored violet to the default theme', () => {
    const migrated = migrateUIStore(
      { theme: 'system', colorTheme: 'violet', sidebarCollapsed: false },
      0,
    );

    expect(migrated).toEqual({
      theme: 'system',
      colorTheme: DEFAULT_COLOR_THEME,
      sidebarCollapsed: false,
    });
  });

  it('leaves a deliberately chosen theme alone', () => {
    const persisted = { theme: 'dark', colorTheme: 'ocean', sidebarCollapsed: true };

    expect(migrateUIStore(persisted, 0)).toEqual(persisted);
  });

  it('preserves the rest of the persisted state while rewriting the theme', () => {
    const migrated = migrateUIStore(
      { theme: 'dark', colorTheme: 'violet', sidebarCollapsed: true },
      0,
    ) as Record<string, unknown>;

    expect(migrated['theme']).toBe('dark');
    expect(migrated['sidebarCollapsed']).toBe(true);
  });

  it('does not re-run once the state is already at the current version', () => {
    // Someone who genuinely picks Violet AFTER the migration must keep it.
    const persisted = { theme: 'system', colorTheme: 'violet', sidebarCollapsed: false };

    expect(migrateUIStore(persisted, 1)).toEqual(persisted);
  });

  it('passes through state it cannot read instead of throwing', () => {
    expect(migrateUIStore(null, 0)).toBeNull();
    expect(migrateUIStore('corrupt', 0)).toBe('corrupt');
  });
});

/**
 * localStorage is a boundary, and this one is written straight onto `<html>`.
 *
 * `applyColorTheme` puts the stored string in `data-theme`, so a value from a
 * REMOVED theme (or a hand-edited entry) leaves the document carrying a theme
 * no token block matches: the brand colors fall back inconsistently while
 * `ThemeSelector` masks it with `?? themes[0]!`, showing the default in the
 * picker while the DOM says otherwise.
 */
describe('migrateUIStore validates the rehydrated blob', () => {
  it('replaces a colorTheme that no longer exists with the default', () => {
    const migrated = migrateUIStore(
      { theme: 'dark', colorTheme: 'sunset', sidebarCollapsed: true },
      1,
    ) as Record<string, unknown>;

    expect(migrated['colorTheme']).toBe(DEFAULT_COLOR_THEME);
    // One bad key costs that key only: the width the user chose survives.
    expect(migrated['theme']).toBe('dark');
    expect(migrated['sidebarCollapsed']).toBe(true);
  });

  it.each([
    ['theme', { theme: 'neon', colorTheme: 'ocean', sidebarCollapsed: true }, 'theme', 'system'],
    [
      'sidebarCollapsed',
      { theme: 'dark', colorTheme: 'ocean', sidebarCollapsed: 'yes' },
      'sidebarCollapsed',
      false,
    ],
  ])('falls back to the default for a bad %s', (_name, persisted, field, expected) => {
    const migrated = migrateUIStore(persisted, 1) as Record<string, unknown>;
    expect(migrated[field]).toBe(expected);
  });

  it('fills in a field the blob is missing entirely', () => {
    const migrated = migrateUIStore({ theme: 'dark' }, 1) as Record<string, unknown>;

    expect(migrated['colorTheme']).toBe(DEFAULT_COLOR_THEME);
    expect(migrated['sidebarCollapsed']).toBe(false);
  });

  it('drops keys the store does not own rather than writing them back', () => {
    const migrated = migrateUIStore(
      { theme: 'dark', colorTheme: 'ocean', sidebarCollapsed: false, injected: 'x' },
      1,
    ) as Record<string, unknown>;

    expect(migrated).not.toHaveProperty('injected');
  });
});
