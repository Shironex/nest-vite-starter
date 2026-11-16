import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import ResetTwoFactorDialog from './ResetTwoFactorDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: { list: { pathFilter: () => ({ queryKey: ['audit', 'list'] }) } },
    user: { listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) } },
    twoFactor: {
      resetUserTwoFactor: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ResetTwoFactorDialog', () => {
  it('warns that the user is signed out and must re-enroll', () => {
    renderWithClient(
      <ResetTwoFactorDialog open onOpenChange={() => {}} targetId="u-1" email="user@example.com" />,
    );
    expect(
      screen.getByRole('heading', { name: /reset two-factor for this user/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/signs them out/i)).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reset two-factor$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <ResetTwoFactorDialog
        open={false}
        onOpenChange={() => {}}
        targetId="u-1"
        email="user@example.com"
      />,
    );
    expect(
      screen.queryByRole('heading', { name: /reset two-factor for this user/i }),
    ).not.toBeInTheDocument();
  });
});
