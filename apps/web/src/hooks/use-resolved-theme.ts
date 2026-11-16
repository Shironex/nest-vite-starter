import { useSyncExternalStore } from 'react';

import { resolveEffectiveTheme, watchSystemTheme } from '@/lib/theme';
import { useUIStore } from '@/stores/ui-store';

/** Snapshot of the OS preference. Only consulted when the user picked 'system'. */
function getSystemTheme(): 'light' | 'dark' {
  return resolveEffectiveTheme('system');
}

function getServerSystemTheme(): 'light' | 'dark' {
  return 'light';
}

/**
 * The theme currently on screen, as a value a component can render from.
 *
 * `useUIStore` alone is not enough: under the 'system' preference the painted
 * theme moves with the OS and nothing writes to the store, so a subscriber to
 * the store never re-renders. `useSyncExternalStore` over the media query reads
 * the current value DURING render, which is also what keeps this out of an
 * effect: `react-hooks/set-state-in-effect` refuses the useState + useEffect
 * shape, and `use-mobile.ts` solves the same problem the same way.
 *
 * Anything that reads the `.dark` class through CSS does not need this. It is
 * for surfaces that take the theme as a value instead: sonner's `<Toaster>`
 * renders in its own React portal and stamps `data-sonner-theme` from a prop.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const preference = useUIStore((s) => s.theme);
  const system = useSyncExternalStore(watchSystemTheme, getSystemTheme, getServerSystemTheme);

  if (preference === 'system') return system;
  return preference;
}
