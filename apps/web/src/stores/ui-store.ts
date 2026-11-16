import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import * as z from 'zod/mini';
import { COLOR_THEMES, DEFAULT_COLOR_THEME } from '@repo/ui/theme';
import type { ColorTheme } from '@repo/ui/theme';
import { applyTheme, applyColorTheme } from '@/lib/theme';
import type { ThemePreference } from '@/lib/theme';

interface IUIState {
  theme: ThemePreference;
  colorTheme: ColorTheme;
  sidebarCollapsed: boolean;
}

interface IUIActions {
  setTheme: (theme: ThemePreference) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

type UIStore = IUIState & IUIActions;

/**
 * Bumped to 1 when SaaS Starter replaced Violet as the default color theme.
 *
 * Before the swap, 'violet' was the value the store seeded itself with AND the
 * sentinel meaning "this user never picked a theme". Every profile that has
 * ever loaded the app therefore has a literal 'violet' in localStorage. Left
 * alone, those users would be pinned to the old palette forever, which is the
 * opposite of making SaaS Starter the brand default. The two cases (seeded vs
 * deliberately chosen) are indistinguishable in the persisted data, so this
 * resolves the ambiguity toward the brand.
 */
const UI_STORE_PERSIST_VERSION = 1;

/**
 * What localStorage is allowed to say, per field, with a default for anything
 * else it says instead.
 *
 * WITHOUT THIS the rehydrated blob was cast (`as Partial<IUIState>`) and
 * trusted: `applyColorTheme` writes `colorTheme` straight onto `<html>` as
 * `data-theme`, so a value left behind by a REMOVED theme, or hand-edited,
 * put a `data-theme` on the document that no token block matches. The brand
 * colors then fall back inconsistently while `ThemeSelector` masks it with
 * `?? themes[0]!`, so the picker shows the default and the DOM disagrees.
 *
 * `.catch()` per field rather than a whole-object refusal: one bad key should
 * cost that key, not the sidebar width the user chose. Built from
 * `COLOR_THEMES` so a theme removed from the package is rejected here the same
 * day, with no second list to keep in step.
 */
const COLOR_THEME_IDS = COLOR_THEMES.map((theme) => theme.id) as [ColorTheme, ...ColorTheme[]];

const persistedUiSchema = z.object({
  theme: z.catch(z.enum(['light', 'dark', 'system']), 'system'),
  colorTheme: z.catch(z.enum(COLOR_THEME_IDS), DEFAULT_COLOR_THEME),
  sidebarCollapsed: z.catch(z.boolean(), false),
});

/** Exported for the regression test, which is the only thing that proves it. */
export function migrateUIStore(persistedState: unknown, version: number): unknown {
  if (typeof persistedState !== 'object' || persistedState === null) return persistedState;

  const state = persistedUiSchema.parse({
    ...(persistedState as Record<string, unknown>),
    // The version-1 swap: 'violet' was BOTH the seeded value and the sentinel
    // for "never picked a theme", so every profile that ever loaded the app
    // carries it. Resolving that ambiguity toward the brand is the whole point
    // of the migration, and it has to happen before the enum check, which
    // would otherwise let 'violet' through untouched.
    ...(version < UI_STORE_PERSIST_VERSION &&
    (persistedState as Partial<IUIState>).colorTheme === 'violet'
      ? { colorTheme: DEFAULT_COLOR_THEME }
      : {}),
  });

  return state;
}

export const useUIStore = create<UIStore>()(
  devtools(
    persist(
      (set) => ({
        theme: 'system',
        colorTheme: DEFAULT_COLOR_THEME,
        sidebarCollapsed: false,
        setTheme: (theme) => {
          applyTheme(theme);
          set({ theme }, undefined, 'ui/setTheme');
        },
        setColorTheme: (colorTheme) => {
          applyColorTheme(colorTheme);
          set({ colorTheme }, undefined, 'ui/setColorTheme');
        },
        setSidebarCollapsed: (collapsed) =>
          set({ sidebarCollapsed: collapsed }, undefined, 'ui/setSidebarCollapsed'),
        toggleSidebar: () =>
          set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }), undefined, 'ui/toggleSidebar'),
      }),
      {
        name: 'ui-store',
        version: UI_STORE_PERSIST_VERSION,
        migrate: migrateUIStore,
        partialize: (state) => ({
          theme: state.theme,
          colorTheme: state.colorTheme,
          sidebarCollapsed: state.sidebarCollapsed,
        }),
      },
    ),
    { name: 'ui' },
  ),
);
