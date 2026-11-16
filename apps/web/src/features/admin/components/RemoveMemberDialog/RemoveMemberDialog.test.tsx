import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import RemoveMemberDialog from './RemoveMemberDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    user: {
      listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) },
      removeMember: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('RemoveMemberDialog', () => {
  it('names the person it is about and offers the action', () => {
    renderWithClient(
      <RemoveMemberDialog open onOpenChange={() => {}} memberId="u-1" email="member@example.com" />,
    );

    expect(screen.getByRole('heading', { name: /disable this account/i })).toBeInTheDocument();
    expect(screen.getByText(/member@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^disable account$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <RemoveMemberDialog
        open={false}
        onOpenChange={() => {}}
        memberId="u-1"
        email="member@example.com"
      />,
    );

    expect(
      screen.queryByRole('heading', { name: /disable this account/i }),
    ).not.toBeInTheDocument();
  });
});
