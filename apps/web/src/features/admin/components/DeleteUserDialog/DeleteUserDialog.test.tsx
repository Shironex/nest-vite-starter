import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import DeleteUserDialog from './DeleteUserDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: { list: { pathFilter: () => ({ queryKey: ['audit', 'list'] }) } },
    user: {
      listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) },
      adminDeleteUser: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('DeleteUserDialog', () => {
  it('warns that the whole account is deleted, not only disabled', () => {
    renderWithClient(
      <DeleteUserDialog open onOpenChange={() => {}} targetId="u-1" email="user@example.com" />,
    );
    expect(screen.getByRole('heading', { name: /delete this account/i })).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/entirely, rather than only disabling it/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete account$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <DeleteUserDialog
        open={false}
        onOpenChange={() => {}}
        targetId="u-1"
        email="user@example.com"
      />,
    );
    expect(screen.queryByRole('heading', { name: /delete this account/i })).not.toBeInTheDocument();
  });
});
