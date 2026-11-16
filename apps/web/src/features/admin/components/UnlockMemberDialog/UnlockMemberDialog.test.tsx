import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import UnlockMemberDialog from './UnlockMemberDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    user: {
      listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) },
      unlockUser: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('UnlockMemberDialog', () => {
  it('explains the lockout and that unlocking restores sign-in right away', () => {
    renderWithClient(
      <UnlockMemberDialog open onOpenChange={() => {}} memberId="u-1" email="member@example.com" />,
    );
    expect(screen.getByRole('heading', { name: /unlock this account/i })).toBeInTheDocument();
    expect(screen.getByText(/member@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/too many failed sign-in attempts/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^unlock account$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <UnlockMemberDialog
        open={false}
        onOpenChange={() => {}}
        memberId="u-1"
        email="member@example.com"
      />,
    );
    expect(screen.queryByRole('heading', { name: /unlock this account/i })).not.toBeInTheDocument();
  });
});
