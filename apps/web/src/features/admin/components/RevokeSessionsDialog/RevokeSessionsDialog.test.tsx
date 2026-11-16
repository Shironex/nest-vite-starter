import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import RevokeSessionsDialog from './RevokeSessionsDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: { list: { pathFilter: () => ({ queryKey: ['audit', 'list'] }) } },
    user: {
      revokeUserSessions: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('RevokeSessionsDialog', () => {
  it('names the person it is about and offers the action', () => {
    renderWithClient(
      <RevokeSessionsDialog open onOpenChange={() => {}} targetId="u-1" email="user@example.com" />,
    );

    expect(
      screen.getByRole('heading', { name: /sign this user out everywhere/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign out everywhere$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <RevokeSessionsDialog
        open={false}
        onOpenChange={() => {}}
        targetId="u-1"
        email="user@example.com"
      />,
    );

    expect(
      screen.queryByRole('heading', { name: /sign this user out everywhere/i }),
    ).not.toBeInTheDocument();
  });
});
