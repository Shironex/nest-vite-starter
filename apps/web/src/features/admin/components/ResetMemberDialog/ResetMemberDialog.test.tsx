import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import ResetMemberDialog from './ResetMemberDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    user: { listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) } },
    twoFactor: {
      resetMemberTwoFactor: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ResetMemberDialog', () => {
  it('warns that the member is signed out and must re-enroll', () => {
    renderWithClient(
      <ResetMemberDialog open onOpenChange={() => {}} memberId="u-1" email="member@example.com" />,
    );
    expect(
      screen.getByRole('heading', { name: /reset two-factor for this member/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/signs them out/i)).toBeInTheDocument();
    expect(screen.getByText(/member@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reset two-factor$/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <ResetMemberDialog
        open={false}
        onOpenChange={() => {}}
        memberId="u-1"
        email="member@example.com"
      />,
    );
    expect(
      screen.queryByRole('heading', { name: /reset two-factor for this member/i }),
    ).not.toBeInTheDocument();
  });
});
