import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { DEFAULT_NOTIFICATION_CHANNELS } from '@repo/shared/schemas';
import NotificationsSection from './NotificationsSection';

const { getFn, updateFn, toastSuccess, toastError } = vi.hoisted(() => ({
  getFn: vi.fn(),
  updateFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@/lib/trpc-errors', () => ({ translateAppError: () => null }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    notifications: {
      preferencesGet: {
        queryOptions: () => ({ queryKey: ['notifications', 'preferencesGet'], queryFn: getFn }),
        queryKey: () => ['notifications', 'preferencesGet'],
        pathKey: () => ['notifications', 'preferencesGet'],
      },
      preferencesUpdate: {
        // The real mutationOptions consumes the `trpc` context (the
        // idempotency key transport); the mock only keeps what useMutation
        // understands.
        mutationOptions: ({ trpc: _trpc, ...opts }: Record<string, unknown> = {}) => ({
          mutationFn: updateFn,
          ...opts,
        }),
      },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderSection = () => render(<NotificationsSection />, { wrapper });

beforeEach(() => {
  vi.clearAllMocks();
  getFn.mockResolvedValue({
    channels: DEFAULT_NOTIFICATION_CHANNELS,
    isDefault: true,
    updatedAt: null,
  });
  updateFn.mockResolvedValue({
    channels: DEFAULT_NOTIFICATION_CHANNELS,
    isDefault: false,
    updatedAt: null,
  });
});

describe('NotificationsSection', () => {
  it('renders one row per category with the English copy', async () => {
    renderSection();

    expect(await screen.findByText('New workspace')).toBeInTheDocument();
    expect(screen.getByText('Admin actions')).toBeInTheDocument();
  });

  it('renders only the WIRED channels: one in-app switch per event row', async () => {
    renderSection();
    await screen.findByText('New workspace');

    // Digest toggles exist only where the backend delivers over them.
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.queryByLabelText('Email digest')).not.toBeInTheDocument();
  });

  it('reflects the defaults: event categories muted', async () => {
    renderSection();
    await screen.findByText('New workspace');

    for (const toggle of screen.getAllByLabelText('In-app')) {
      expect(toggle).not.toBeChecked();
    }
  });

  it('saves the WHOLE matrix with exactly the flipped flag changed', async () => {
    renderSection();
    await screen.findByText('New workspace');

    fireEvent.click(screen.getAllByLabelText('In-app')[0] as HTMLElement);

    await waitFor(() => expect(updateFn).toHaveBeenCalledTimes(1));
    // First argument only: TanStack passes its own context object second.
    expect(updateFn.mock.calls[0]?.[0]).toEqual({
      channels: {
        ...DEFAULT_NOTIFICATION_CHANNELS,
        WORKSPACE_CREATED: { ...DEFAULT_NOTIFICATION_CHANNELS.WORKSPACE_CREATED, inApp: true },
      },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('surfaces a failed save as an error toast', async () => {
    updateFn.mockRejectedValue(new Error('boom'));
    renderSection();
    await screen.findByText('New workspace');

    fireEvent.click(screen.getAllByLabelText('In-app')[0] as HTMLElement);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('shows the load-error copy when the read fails', async () => {
    getFn.mockRejectedValue(new Error('boom'));
    renderSection();

    expect(await screen.findByText('Failed to load notification settings.')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});
