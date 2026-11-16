import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import UnlockUserDialog from './UnlockUserDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: { list: { pathFilter: () => ({ queryKey: ['audit', 'list'] }) } },
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

describe('UnlockUserDialog', () => {
  it('explains the lockout and that unlocking restores sign-in right away', () => {
    renderWithClient(
      <UnlockUserDialog open onOpenChange={() => {}} targetId="u-1" email="user@example.com" />,
    );
    expect(screen.getByRole('heading', { name: /unlock this account/i })).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/too many failed sign-in attempts/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^unlock account$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <UnlockUserDialog
        open={false}
        onOpenChange={() => {}}
        targetId="u-1"
        email="user@example.com"
      />,
    );
    expect(screen.queryByRole('heading', { name: /unlock this account/i })).not.toBeInTheDocument();
  });
});
