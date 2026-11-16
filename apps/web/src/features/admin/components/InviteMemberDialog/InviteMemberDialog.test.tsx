import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import InviteMemberDialog from './InviteMemberDialog';

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    user: { listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) } },
    staffInvite: { send: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('InviteMemberDialog', () => {
  it('asks for an address and a role, and says how long the link lasts', () => {
    renderWithClient(<InviteMemberDialog open onOpenChange={() => {}} />);

    expect(
      screen.getByRole('heading', { name: /invite someone to the organization/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByText(/lasts 7 days/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send invitation/i })).toBeInTheDocument();
  });

  it('defaults to the narrower role, so making an admin is always deliberate', () => {
    renderWithClient(<InviteMemberDialog open onOpenChange={() => {}} />);

    expect(screen.getByRole('radio', { name: /^user/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^administrator/i })).not.toBeChecked();
  });

  it('explains what each role can do, rather than naming it and stopping', () => {
    // An admin picking a role for somebody else is choosing a capability, and
    // "Administrator" alone does not say which one.
    renderWithClient(<InviteMemberDialog open onOpenChange={() => {}} />);

    expect(screen.getByText(/no account management/i)).toBeInTheDocument();
    expect(screen.getByText(/inviting people, changing roles/i)).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(<InviteMemberDialog open={false} onOpenChange={() => {}} />);

    expect(screen.queryByRole('heading', { name: /invite someone/i })).not.toBeInTheDocument();
  });
});
