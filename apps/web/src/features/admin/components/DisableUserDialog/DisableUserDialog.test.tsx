import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import DisableUserDialog from './DisableUserDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: { list: { pathFilter: () => ({ queryKey: ['audit', 'list'] }) } },
    user: {
      listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) },
      disableUser: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('DisableUserDialog', () => {
  it('names the person it is about and offers the action', () => {
    renderWithClient(
      <DisableUserDialog open onOpenChange={() => {}} targetId="u-1" email="user@example.com" />,
    );

    expect(screen.getByRole('heading', { name: /disable this account/i })).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^disable account$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <DisableUserDialog
        open={false}
        onOpenChange={() => {}}
        targetId="u-1"
        email="user@example.com"
      />,
    );

    expect(
      screen.queryByRole('heading', { name: /disable this account/i }),
    ).not.toBeInTheDocument();
  });
});
