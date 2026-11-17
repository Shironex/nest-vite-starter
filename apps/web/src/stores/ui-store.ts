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
 * The persisted shape's version. Bump it only when the SHAPE changes. `migrate`
 * runs only when the stored version differs from this one, so it is NOT what
 * rejects a theme that left the package: `merge` below validates the stored
 * blob on every rehydrate, at the current version too.
 */
const UI_STORE_PERSIST_VERSION = 1;

/**
 * What localStorage is allowed to say, per field, with a default for anything
 * else it says instead.
 *
 * WITHOUT THIS the rehydrated blob was cast (`as Partial<IUIState>`) and
 * trusted: `applyColorTheme` writes `colorTheme` straight onto `<html>` as
 * `data-theme`, so a value left behind by a REMOVED theme, or hand-edited,
 * put a `data-theme` on the document that no token block matches, and the brand
 * colors then fall back inconsistently.
 *
 * `.catch()` per field rather than a whole-object refusal: one bad key should
 * cost that key, not the sidebar width the user chose. Built from
 * `COLOR_THEMES` so a theme removed from the package is rejected here the same
 * day, with no second list to keep in step. Applied by `merge` on every
 * rehydrate (and by `migrate` on a version change).
 */
const COLOR_THEME_IDS = COLOR_THEMES.map((theme) => theme.id) as [ColorTheme, ...ColorTheme[]];

const persistedUiSchema = z.object({
  theme: z.catch(z.enum(['light', 'dark', 'system']), 'system'),
  colorTheme: z.catch(z.enum(COLOR_THEME_IDS), DEFAULT_COLOR_THEME),
  sidebarCollapsed: z.catch(z.boolean(), false),
});

/** Exported for the regression test, which is the only thing that proves it. */
export function migrateUIStore(persistedState: unknown): unknown {
  if (typeof persistedState !== 'object' || persistedState === null) return persistedState;
  return persistedUiSchema.parse(persistedState);
}

/**
 * Runs on EVERY rehydrate, unlike `migrate`, so a stored theme id that no longer
 * exists (or junk) lands on the default even at the current version.
 */
function mergeUIStore(persistedState: unknown, currentState: UIStore): UIStore {
  const sanitized = migrateUIStore(persistedState);
  if (typeof sanitized !== 'object' || sanitized === null) return currentState;
  return { ...currentState, ...(sanitized as Partial<IUIState>) };
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
        merge: mergeUIStore,
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
