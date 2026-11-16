import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { TourProgressOutput } from '@repo/shared/schemas';
import { useTourRequestStore } from '@/stores/tour-store';
import { useTourLauncher } from './TourLauncher.hooks';

const { progressFn, saveFn, invalidateQueries, canRunTour, runTour, isModalOpen, pathname } =
  vi.hoisted(() => ({
    progressFn: vi.fn(),
    saveFn: vi.fn(),
    invalidateQueries: vi.fn(),
    canRunTour: vi.fn(),
    runTour: vi.fn(),
    isModalOpen: vi.fn(() => false),
    pathname: { current: '/dashboard' },
  }));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: pathname.current } }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@/features/help/Help.engine', () => ({ canRunTour, runTour, isModalOpen }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    help: {
      progressGet: {
        queryOptions: () => ({ queryKey: ['help', 'progressGet'], queryFn: progressFn }),
        queryKey: () => ['help', 'progressGet'],
        pathKey: () => ['help', 'progressGet'],
      },
      progressSave: { mutationOptions: (opts?: object) => ({ mutationFn: saveFn, ...opts }) },
      progressResetAll: { mutationOptions: (opts?: object) => ({ mutationFn: vi.fn(), ...opts }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const EMPTY: TourProgressOutput = { tours: {}, updatedAt: null };
const SEEN: TourProgressOutput = {
  tours: { dashboard: { completedAt: '2026-08-01T09:00:00.000Z', version: 1, dismissed: false } },
  updatedAt: '2026-08-01T09:00:00.000Z',
};

beforeEach(() => {
  pathname.current = '/dashboard';
  progressFn.mockResolvedValue(EMPTY);
  saveFn.mockResolvedValue(EMPTY);
  canRunTour.mockResolvedValue(true);
  runTour.mockResolvedValue('completed');
  // `clearAllMocks` clears calls but NOT an implementation set with
  // mockReturnValue, so the modal case would otherwise leak into every test
  // that ran after it and suppress every auto-start.
  isModalOpen.mockReturnValue(false);
  useTourRequestStore.getState().clearTourRequest();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useTourLauncher', () => {
  it('offers the tour registered for the current route', async () => {
    const { result } = renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(true);
    });
  });

  /**
   * A screen with no tour gets no control at all. An empty tour is not a tour,
   * and a help button that opens nothing is worse than none.
   */
  it('offers nothing on a screen with no tour, and does not even probe for anchors', async () => {
    pathname.current = '/audit';

    const { result } = renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(false);
    });
    expect(canRunTour).not.toHaveBeenCalled();
  });

  it('offers nothing when the screen has a tour but none of its anchors are there', async () => {
    canRunTour.mockResolvedValue(false);

    const { result } = renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(false);
    });
    expect(runTour).not.toHaveBeenCalled();
  });

  it('auto-starts once for a user who has never answered', async () => {
    renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(runTour).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(saveFn).toHaveBeenCalledWith(
        expect.objectContaining({ tourId: 'dashboard', dismissed: false }),
        expect.anything(),
      );
    });
  });

  it('does not auto-start while a modal is open, and still offers the tour later', async () => {
    /*
     * A tour and a dialog are both full-screen overlays and they do not
     * compose: driver.js masks everything outside its spotlight, so a tour
     * started over a dialog leaves that dialog's fields resolvable, apparently
     * enabled, and silently unclickable. Found by an e2e run that retried one
     * click 338 times against a live overlay.
     */
    isModalOpen.mockReturnValue(true);

    const view = renderHook(() => useTourLauncher(), { wrapper });
    await waitFor(() => {
      expect(view.result.current.isAvailable).toBe(true);
    });

    expect(runTour).not.toHaveBeenCalled();
    // Skipped, NOT answered: nothing is recorded, so the next unobstructed
    // visit still gets the one offer this tour is allowed.
    expect(saveFn).not.toHaveBeenCalled();
  });

  /**
   * The conservative half of the design. Staff live in this app all day, and an
   * unrequested overlay on a screen somebody is working in is exactly the
   * irritation the design direction warns about.
   */
  it('never auto-starts a tour the user has already answered', async () => {
    progressFn.mockResolvedValue(SEEN);

    const { result } = renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(true);
    });
    expect(runTour).not.toHaveBeenCalled();
  });

  it('does not auto-start while the progress read is still in flight', async () => {
    progressFn.mockImplementation(() => new Promise(() => undefined));

    const { result } = renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(true);
    });
    expect(runTour).not.toHaveBeenCalled();
  });

  it('records a dismissal, so a closed tour is not re-offered either', async () => {
    runTour.mockResolvedValue('dismissed');

    renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(saveFn).toHaveBeenCalledWith(
        expect.objectContaining({ dismissed: true }),
        expect.anything(),
      );
    });
  });

  /**
   * 'unavailable' means the user was shown nothing. Recording a completion for
   * it would silently retire a tour that never ran.
   */
  it('records nothing when the tour turned out to be unrunnable', async () => {
    runTour.mockResolvedValue('unavailable');

    renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(runTour).toHaveBeenCalled();
    });
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('runs a replay requested from elsewhere, and clears the request so it cannot re-arm', async () => {
    progressFn.mockResolvedValue(SEEN);
    useTourRequestStore.getState().requestTour('dashboard');

    renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(runTour).toHaveBeenCalledTimes(1);
    });
    expect(useTourRequestStore.getState().pendingTourId).toBeNull();
  });

  it('ignores a replay request aimed at a different screen', async () => {
    progressFn.mockResolvedValue(SEEN);
    useTourRequestStore.getState().requestTour('workspaces');

    const { result } = renderHook(() => useTourLauncher(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(true);
    });
    expect(runTour).not.toHaveBeenCalled();
    expect(useTourRequestStore.getState().pendingTourId).toBe('workspaces');
  });
});
