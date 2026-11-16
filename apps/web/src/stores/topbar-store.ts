import { useEffect, useId } from 'react';
import { create } from 'zustand';

/**
 * The app shell's topbar subtitle, published by whichever page is mounted.
 *
 * WHY A PUBLISHED SLOT AND NOT A CONFIG KEY. `features/layout/Layout.nav.ts`
 * carries a static `pageTitleKey` per route, and the obvious symmetry would be a
 * `pageSubtitleKey` beside it. That cannot express what the design draws: the
 * dashboard subtitle is a live localized date ("Tuesday,
 * July 14, 2026") and a list screen's subtitle is a live record count ("12
 * workspaces, 9 active"). Both are data, not copy.
 *
 * WHY IT LIVES IN `stores/` AND NOT IN THE LAYOUT FEATURE. The shell cannot
 * fetch that data itself, and it should not: it has no business knowing what a
 * feature's records are. So the feature publishes and the shell renders. But
 * `no-cross-feature-imports` forbids one feature importing another's runtime
 * code in EITHER direction, so a hook exported from `features/layout` could not
 * be called from `features/dashboard`. A store is the shared module both sides
 * are allowed to depend on.
 *
 * A page with nothing useful to say publishes nothing and the row collapses to
 * the title alone. That is the honest default: inventing static filler for a
 * slot the design fills with data is what commit `86b9e47` removed from the
 * landing page.
 */
interface ITopbarState {
  /** Current subtitle, or `null` when no page is publishing one. */
  subtitle: string | null;
  /** Which `useSetTopbarSubtitle` caller owns the current value. */
  ownerId: string | null;
}

interface ITopbarActions {
  publish: (ownerId: string, subtitle: string | null) => void;
  withdraw: (ownerId: string) => void;
}

export const useTopbarStore = create<ITopbarState & ITopbarActions>((set) => ({
  subtitle: null,
  ownerId: null,
  publish: (ownerId, subtitle) => set({ ownerId, subtitle }),
  /*
   * Ownership check, not an unconditional clear. On navigation React can mount
   * the incoming page before running the outgoing page's cleanup, so an
   * unconditional clear would wipe the subtitle the NEW page just published and
   * leave the row empty until something else re-rendered.
   */
  withdraw: (ownerId) =>
    set((state) => (state.ownerId === ownerId ? { ownerId: null, subtitle: null } : state)),
}));

/**
 * Publishes this page's topbar subtitle for as long as it is mounted.
 *
 * Pass `null` while the data is still loading rather than a placeholder: a
 * subtitle that flickers from "0 workspaces" to the real figure reads as a
 * wrong answer being corrected, which is worse than one arriving a moment late.
 */
export function useSetTopbarSubtitle(subtitle: string | null): void {
  const ownerId = useId();

  useEffect(() => {
    const { publish, withdraw } = useTopbarStore.getState();
    publish(ownerId, subtitle);
    return () => withdraw(ownerId);
  }, [ownerId, subtitle]);
}

/** Reads the published subtitle. */
export function useTopbarSubtitle(): string | null {
  return useTopbarStore((s) => s.subtitle);
}
