import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import ChangeUserRoleDialog from './ChangeUserRoleDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: { list: { pathFilter: () => ({ queryKey: ['audit', 'list'] }) } },
    user: {
      listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) },
      updateUserRole: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ChangeUserRoleDialog', () => {
  it('spells out the promotion from user to administrator and the sign-out', () => {
    renderWithClient(
      <ChangeUserRoleDialog
        open
        onOpenChange={() => {}}
        targetId="u-1"
        email="user@example.com"
        userRole="USER"
      />,
    );
    expect(screen.getByRole('heading', { name: /change this user's role/i })).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/from "User" to "Administrator"/)).toBeInTheDocument();
    expect(screen.getByText(/is signed out/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^change role$/i })).toBeInTheDocument();
  });

  it('offers the demotion to user for an administrator', () => {
    renderWithClient(
      <ChangeUserRoleDialog
        open
        onOpenChange={() => {}}
        targetId="u-1"
        email="admin@example.com"
        userRole="ADMIN"
      />,
    );
    expect(screen.getByText(/from "Administrator" to "User"/)).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <ChangeUserRoleDialog
        open={false}
        onOpenChange={() => {}}
        targetId="u-1"
        email="user@example.com"
        userRole="USER"
      />,
    );
    expect(
      screen.queryByRole('heading', { name: /change this user's role/i }),
    ).not.toBeInTheDocument();
  });
});
