import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationListOutput } from '@repo/shared/schemas';
import NotificationBell from './NotificationBell';

// Mutable fixture the mocked list query resolves with, set per test.
let listPage: NotificationListOutput = { items: [], unreadCount: 0 };

// Stub @/lib/trpc so no network or Electron bootstrap is needed in tests.
vi.mock('@/lib/trpc', () => ({
  trpc: {
    notifications: {
      list: {
        queryOptions: (input: unknown) => ({
          queryKey: ['notifications', 'list', input],
          queryFn: () => Promise.resolve(listPage),
        }),
        queryKey: (input: unknown) => ['notifications', 'list', input],
        pathFilter: () => ({ queryKey: ['notifications', 'list'] }),
      },
      markAllRead: {
        mutationOptions: (opts?: object) => ({
          mutationFn: () => Promise.resolve({ updated: 0 }),
          ...opts,
        }),
      },
      markRead: {
        mutationOptions: (opts?: object) => ({
          mutationFn: () => Promise.resolve({ updated: false }),
          ...opts,
        }),
      },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const makeItem = (id: string) => ({
  id,
  type: 'info' as const,
  title: `Title ${id}`,
  message: `Message ${id}`,
  read: false,
  createdAt: '2026-07-02T10:00:00.000Z',
});

afterEach(() => {
  listPage = { items: [], unreadCount: 0 };
});

describe('NotificationBell', () => {
  it('renders the trigger button before the list query resolves', () => {
    renderWithClient(<NotificationBell />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not render a badge when unreadCount is 0', async () => {
    const { container } = renderWithClient(<NotificationBell />);
    await screen.findByText('Notifications');
    const badge = container.querySelector('.bg-primary');
    expect(badge).not.toBeInTheDocument();
  });

  it('shows the unread count from the hydrated query data', async () => {
    listPage = { items: [makeItem('n1'), makeItem('n2')], unreadCount: 2 };
    renderWithClient(<NotificationBell />);
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  it('caps the badge label at 9+', async () => {
    listPage = { items: [makeItem('n1')], unreadCount: 12 };
    renderWithClient(<NotificationBell />);
    expect(await screen.findByText('9+')).toBeInTheDocument();
    // The trigger's accessible name concatenates the badge and the sr-only
    // label, so match on the label substring.
    expect(screen.getByRole('button', { name: /Notifications \(12 unread\)/ })).toBeInTheDocument();
  });
});
