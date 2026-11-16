import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { formatDate } from '@/lib/i18n';
import { translateAppError } from '@/lib/trpc-errors';
import { TOURS, getTourById, tourNameKey } from '@/features/help/Help.tours';
import { useTourProgress } from '@/features/help/Help.queries';
import { useResetTourProgress } from '@/features/help/Help.mutations';
import { HELP_NS } from '@/features/help/Help.i18n';
import { useTourRequestStore } from '@/stores/tour-store';
import type { IHelpToursSectionView, TourRowStatus } from './HelpToursSection.types';

/**
 * "Help and tours": every tour in the app, whether it has been seen, and a
 * way to run it again. The other half of the replay ask, and the half that
 * matters for a tour on a screen somebody is not currently on.
 *
 * REPLAY GOES THROUGH THE STORE AND THE ROUTER, not through the engine. A tour
 * spotlights `data-tour` elements, so it can only run on its own screen: the
 * row records the request, navigates, and the launcher already mounted in the
 * app shell picks it up once the target screen has rendered its anchors. That
 * also means one code path starts every tour, whichever control asked for it.
 */
export function useHelpToursSection(): IHelpToursSectionView {
  const { t } = useTranslation(HELP_NS);
  const navigate = useNavigate();
  const progress = useTourProgress();
  const reset = useResetTourProgress();

  const stored = progress.data?.tours ?? {};

  const rows = TOURS.map((tour) => {
    const entry = stored[tour.id];
    let status: TourRowStatus = 'unseen';
    if (entry) status = entry.dismissed ? 'dismissed' : 'completed';
    const date = entry ? formatDate(entry.completedAt) : '';
    return {
      id: tour.id,
      name: t(tourNameKey(tour)),
      route: tour.route,
      status,
      statusLabel:
        status === 'unseen'
          ? t('settings.statusUnseen')
          : t(`settings.status${status === 'dismissed' ? 'Dismissed' : 'Completed'}`, { date }),
    };
  });

  function onReplay(tourId: string): void {
    // Resolved through the registry rather than trusted: the id comes from a
    // row this component built, but going through `getTourById` is what keeps
    // every consumer of a tour id on the same tolerant path.
    const tour = getTourById(tourId);
    if (!tour) return;
    useTourRequestStore.getState().requestTour(tour.id);
    void navigate({ to: tour.route });
  }

  function onResetAll(): void {
    reset.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('settings.resetSuccess'));
      },
      onError: (error) => {
        toast.error(translateAppError(error) ?? t('settings.saveError'));
      },
    });
  }

  return {
    rows,
    isLoading: progress.isPending,
    hasLoadError: progress.isError,
    isResetting: reset.isPending,
    labels: {
      title: t('settings.title'),
      description: t('settings.description'),
      columnTour: t('settings.columnTour'),
      columnScreen: t('settings.columnScreen'),
      columnStatus: t('settings.columnStatus'),
      replay: t('settings.replay'),
      resetAll: t('settings.resetAll'),
      loadError: t('settings.loadError'),
    },
    onReplay,
    onResetAll,
  };
}
