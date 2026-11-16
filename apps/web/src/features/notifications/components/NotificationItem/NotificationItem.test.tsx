import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationItemOutput } from '@repo/shared/schemas';
import NotificationItem from './NotificationItem';

const markReadMutationFn = vi.fn().mockResolvedValue({ updated: true });

// Stub @/lib/trpc so no network or Electron bootstrap is needed in tests.
vi.mock('@/lib/trpc', () => ({
  trpc: {
    notifications: {
      list: {
        queryKey: (input: unknown) => ['notifications', 'list', input],
        pathFilter: () => ({ queryKey: ['notifications', 'list'] }),
      },
      markRead: {
        mutationOptions: (opts?: object) => ({
          mutationFn: (input: { id: string }) => markReadMutationFn(input),
          ...opts,
        }),
      },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const makeNotification = (
  overrides: Partial<NotificationItemOutput> = {},
): NotificationItemOutput => ({
  id: 'test-1',
  type: 'info',
  title: 'Test notification',
  message: 'This is a test message.',
  createdAt: '2023-11-14T22:13:20.000Z',
  read: false,
  ...overrides,
});

beforeEach(() => {
  markReadMutationFn.mockClear();
});

describe('NotificationItem', () => {
  it('renders the notification title and message', () => {
    renderWithClient(<NotificationItem notification={makeNotification()} />);
    expect(screen.getByText('Test notification')).toBeInTheDocument();
    expect(screen.getByText('This is a test message.')).toBeInTheDocument();
  });

  it('shows the unread indicator when the notification is unread', () => {
    const { container } = renderWithClient(
      <NotificationItem notification={makeNotification({ read: false })} />,
    );
    const dot = container.querySelector('.bg-brand');
    expect(dot).toBeInTheDocument();
  });

  it('hides the unread indicator when the notification is read', () => {
    const { container } = renderWithClient(
      <NotificationItem notification={makeNotification({ read: true })} />,
    );
    const dot = container.querySelector('.bg-brand');
    expect(dot).not.toBeInTheDocument();
  });

  it('applies opacity-60 class when the notification is read', () => {
    renderWithClient(<NotificationItem notification={makeNotification({ read: true })} />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('opacity-60');
  });

  it('clicking an unread item fires the markRead mutation with the id', async () => {
    renderWithClient(<NotificationItem notification={makeNotification({ id: 'n-7' })} />);
    fireEvent.click(screen.getByRole('button'));
    // useMutation dispatches mutationFn asynchronously; wait for it.
    await waitFor(() => {
      expect(markReadMutationFn).toHaveBeenCalledWith({ id: 'n-7' });
    });
  });

  it('clicking an already-read item does not fire the mutation', async () => {
    renderWithClient(<NotificationItem notification={makeNotification({ read: true })} />);
    fireEvent.click(screen.getByRole('button'));
    // Flush the microtask queue so an (incorrect) async dispatch would land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(markReadMutationFn).not.toHaveBeenCalled();
  });
});
