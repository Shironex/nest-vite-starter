import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { canRunTour, isModalOpen, runTour } from '@/features/help/Help.engine';
import { findTourForRoute, tourNameKey, tourStepKeys } from '@/features/help/Help.tours';
import { useTourProgress } from '@/features/help/Help.queries';
import { useSaveTourProgress } from '@/features/help/Help.mutations';
import type { ITour, ITourCopy, TourOutcome } from '@/features/help/Help.types';
import { HELP_NS } from '@/features/help/Help.i18n';
import { useTourRequestStore } from '@/stores/tour-store';
import type { ITourLauncherView } from './TourLauncher.types';

/** Resolve a tour's whole copy set in one go, in whichever language is active. */
function useTourCopy(): (tour: ITour) => ITourCopy {
  const { t } = useTranslation(HELP_NS);
  return useCallback(
    (tour: ITour) => ({
      steps: tour.steps.map((step) => {
        const keys = tourStepKeys(tour, step);
        return { title: t(keys.titleKey), body: t(keys.bodyKey) };
      }),
      next: t('controls.next'),
      previous: t('controls.previous'),
      done: t('controls.done'),
      close: t('controls.close'),
      progress: t('controls.progress'),
    }),
    [t],
  );
}

/**
 * The per-screen help control, and the one place a tour is ever started.
 *
 * It answers three questions, in this order, because each one gates the next:
 *
 *   1. Does this route have a tour? If not, no control and nothing else runs.
 *   2. Can it run right now (is at least one anchor in the DOM)? Probed
 *      asynchronously per route, so a screen still fetching its table does not
 *      hide its own help.
 *   3. Should it start on its own? At most once per screen per user, and only
 *      for someone who has never answered.
 *
 * The auto-start is deliberately conservative. Staff live in this app all day,
 * and an unrequested overlay on a screen somebody is working in is the exact
 * irritation the design direction warns about. Finishing OR closing a tour both
 * count as an answer and both suppress it forever after.
 */
export function useTourLauncher(): ITourLauncherView {
  const { t } = useTranslation(HELP_NS);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tour = findTourForRoute(pathname);
  const buildCopy = useTourCopy();

  const progress = useTourProgress();
  const save = useSaveTourProgress();

  /*
   * The id of the tour whose anchors were found, rather than a bare boolean.
   *
   * The launcher stays mounted across route changes, so a boolean would have to
   * be reset synchronously on every navigation to stop the previous screen's
   * answer leaking into the next one, and a synchronous setState in an effect
   * is a cascading render (`react-hooks/set-state-in-effect`). Comparing an id
   * makes the stale answer simply not match, with no reset at all.
   */
  const [availableTourId, setAvailableTourId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const isAvailable = tour !== null && availableTourId === tour.id;

  /**
   * Tours already started in this browser session, by id.
   *
   * A ref rather than state: it must not re-render anything, and it must
   * survive StrictMode's double effect pass, which would otherwise run every
   * auto-started tour twice on mount in development.
   */
  const startedRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);

  const start = useCallback(
    async (target: ITour) => {
      if (runningRef.current) return;
      runningRef.current = true;
      // Captured BEFORE `setIsRunning(true)`, which disables the launcher, and a
      // disabled button is blurred: read any later and the element focus should
      // return to is already gone.
      const origin = document.activeElement;
      startedRef.current.add(target.id);
      setIsRunning(true);
      let outcome: TourOutcome;
      try {
        outcome = await runTour(target, buildCopy(target), { origin });
      } finally {
        runningRef.current = false;
        setIsRunning(false);
      }
      // 'unavailable' records nothing: the user was shown nothing, so there is
      // nothing they have seen, and writing a completion would silently retire
      // a tour that never ran.
      if (outcome === 'unavailable') return;
      save.mutate({
        tourId: target.id,
        version: target.version,
        dismissed: outcome === 'dismissed',
      });
    },
    [buildCopy, save],
  );

  // Availability is per route, and re-probed on every route change: the same
  // launcher instance stays mounted in the shell across navigations.
  useEffect(() => {
    if (!tour) return;
    let cancelled = false;
    void canRunTour(tour).then((available) => {
      if (!cancelled && available) setAvailableTourId(tour.id);
    });
    return () => {
      cancelled = true;
    };
  }, [tour]);

  // A replay asked for from somewhere that could not run it (the settings
  // list, which may have had to navigate here first). Cleared BEFORE the tour
  // starts so a closed tour cannot re-arm itself on the next render.
  useEffect(() => {
    if (!tour || !isAvailable) return;
    const state = useTourRequestStore.getState();
    if (state.pendingTourId !== tour.id) return;
    state.clearTourRequest();
    void start(tour);
  }, [tour, isAvailable, start]);

  useEffect(() => {
    if (!tour || !isAvailable) return;
    if (startedRef.current.has(tour.id)) return;
    // Wait for the answer rather than guessing at it: auto-starting on a
    // pending read would re-offer every tour on every cold load.
    if (progress.data === undefined) return;
    if (progress.data.tours[tour.id] !== undefined) return;
    /*
     * Never auto-start over a modal. A tour and a dialog are both full-screen
     * overlays and they do not compose: driver.js masks everything outside its
     * spotlight, so the dialog's own fields stop accepting clicks while looking
     * perfectly normal. The user reads that as a frozen form, not as a tour.
     *
     * Deliberately a silent skip rather than a queue. This tour is offered at
     * most once per user, and the screen behind a dialog is not the moment to
     * spend that one offer. It stays unanswered in `progress`, so the next
     * unobstructed visit to this route offers it again, and the help button is
     * there in the meantime.
     *
     * Only the AUTO path is guarded. An explicit replay is a deliberate act, and
     * `onStart` is not reachable while a modal covers the topbar anyway.
     */
    if (isModalOpen()) return;
    void start(tour);
  }, [tour, isAvailable, progress.data, start]);

  return {
    isAvailable,
    label: t('launcher.label'),
    tooltip: tour ? t(tourNameKey(tour)) : t('launcher.tooltip'),
    isRunning,
    onStart: () => {
      if (tour) void start(tour);
    },
  };
}
