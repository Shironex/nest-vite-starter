import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import RevokeInviteDialog from './RevokeInviteDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    user: { listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) } },
    staffInvite: { revoke: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('RevokeInviteDialog', () => {
  it('names the person it is about and offers the action', () => {
    renderWithClient(
      <RevokeInviteDialog open onOpenChange={() => {}} memberId="u-1" email="member@example.com" />,
    );

    expect(screen.getByRole('heading', { name: /withdraw this invitation/i })).toBeInTheDocument();
    expect(screen.getByText(/member@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^withdraw invitation$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <RevokeInviteDialog
        open={false}
        onOpenChange={() => {}}
        memberId="u-1"
        email="member@example.com"
      />,
    );

    expect(
      screen.queryByRole('heading', { name: /withdraw this invitation/i }),
    ).not.toBeInTheDocument();
  });
});
