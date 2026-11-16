import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { TourProgressOutput } from '@repo/shared/schemas';
import { useTourRequestStore } from '@/stores/tour-store';
import { useHelpToursSection } from './HelpToursSection.hooks';

const { progressFn, resetFn, invalidateQueries, navigate } = vi.hoisted(() => ({
  progressFn: vi.fn(),
  resetFn: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@/lib/trpc', () => ({
  trpc: {
    help: {
      progressGet: {
        queryOptions: () => ({ queryKey: ['help', 'progressGet'], queryFn: progressFn }),
        queryKey: () => ['help', 'progressGet'],
        pathKey: () => ['help', 'progressGet'],
      },
      progressSave: { mutationOptions: (opts?: object) => ({ mutationFn: vi.fn(), ...opts }) },
      progressResetAll: { mutationOptions: (opts?: object) => ({ mutationFn: resetFn, ...opts }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const entry = (dismissed: boolean) => ({
  completedAt: '2026-08-01T09:00:00.000Z',
  version: 1,
  dismissed,
});

beforeEach(() => {
  progressFn.mockResolvedValue({ tours: {}, updatedAt: null } satisfies TourProgressOutput);
  resetFn.mockResolvedValue({ tours: {}, updatedAt: null });
  useTourRequestStore.getState().clearTourRequest();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useHelpToursSection', () => {
  it('lists every registered tour, seen or not', async () => {
    const { result } = renderHook(() => useHelpToursSection(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.rows.map((row) => row.id)).toEqual(['dashboard']);
    expect(result.current.rows.every((row) => row.status === 'unseen')).toBe(true);
  });

  it('separates a completed tour from one that was closed halfway', async () => {
    // One registered tour, so the two outcomes are read one after the other.
    progressFn.mockResolvedValue({
      tours: { dashboard: entry(false) },
      updatedAt: '2026-08-01T09:00:00.000Z',
    });
    const completed = renderHook(() => useHelpToursSection(), { wrapper });
    await waitFor(() => {
      expect(completed.result.current.rows[0]?.status).toBe('completed');
    });

    progressFn.mockResolvedValue({
      tours: { dashboard: entry(true) },
      updatedAt: '2026-08-01T09:00:00.000Z',
    });
    const dismissed = renderHook(() => useHelpToursSection(), { wrapper });
    await waitFor(() => {
      expect(dismissed.result.current.rows[0]?.status).toBe('dismissed');
    });
  });

  /**
   * The client half of the tolerant read, at the surface where it is visible.
   * A stored entry for a tour that was renamed or removed is simply not a row:
   * the list is built from the REGISTRY and looks progress up in it, never the
   * other way round, so an unknown id cannot render a row for a screen that no
   * longer exists and cannot throw on the way past.
   */
  it('ignores a stored tour the registry no longer knows', async () => {
    progressFn.mockResolvedValue({
      tours: { 'retired-screen': entry(false), dashboard: entry(false) },
      updatedAt: '2026-08-01T09:00:00.000Z',
    });

    const { result } = renderHook(() => useHelpToursSection(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.rows.map((row) => row.id)).toEqual(['dashboard']);
    expect(result.current.rows[0]?.status).toBe('completed');
  });

  /**
   * A tour spotlights `data-tour` elements, so it can only run on its own
   * screen. The row records the request and navigates; the launcher already
   * mounted in the shell runs it once the target screen has its anchors.
   */
  it('replays by recording the request and navigating to the tour route', async () => {
    const { result } = renderHook(() => useHelpToursSection(), { wrapper });

    result.current.onReplay('dashboard');

    expect(useTourRequestStore.getState().pendingTourId).toBe('dashboard');
    expect(navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('ignores a replay for an id the registry does not have', async () => {
    const { result } = renderHook(() => useHelpToursSection(), { wrapper });

    result.current.onReplay('retired-screen');

    expect(useTourRequestStore.getState().pendingTourId).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('resets every tour at once', async () => {
    const { result } = renderHook(() => useHelpToursSection(), { wrapper });

    result.current.onResetAll();

    await waitFor(() => {
      expect(resetFn).toHaveBeenCalled();
    });
  });
});
