import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WithdrawInviteByEmailDialog from './WithdrawInviteByEmailDialog';

const { withdrawFn } = vi.hoisted(() => ({ withdrawFn: vi.fn() }));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    staffInvite: { withdrawByEmail: { mutationOptions: () => ({ mutationFn: withdrawFn }) } },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('WithdrawInviteByEmailDialog', () => {
  it('asks for an address and says which invitations it reaches', () => {
    renderWithClient(<WithdrawInviteByEmailDialog open onOpenChange={() => {}} />);

    expect(
      screen.getByRole('heading', { name: /withdraw an invitation by email address/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^email address$/i)).toBeInTheDocument();
    // Which invitations: the ones with no row. And where the others live.
    expect(screen.getByText(/account in another organization/i)).toBeInTheDocument();
    expect(screen.getByText(/from that person's row menu/i)).toBeInTheDocument();
  });

  it('states plainly what withdrawing does, and what it leaves alone', () => {
    renderWithClient(<WithdrawInviteByEmailDialog open onOpenChange={() => {}} />);

    expect(screen.getByText(/the invitation link stops working/i)).toBeInTheDocument();
    expect(screen.getByText(/is left as it is/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^withdraw invitation$/i })).toBeInTheDocument();
  });

  it('does not send an address that is not one', async () => {
    renderWithClient(<WithdrawInviteByEmailDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/^email address$/i), {
      target: { value: 'not-an-address' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^withdraw invitation$/i }));

    await waitFor(() => expect(screen.getByLabelText(/^email address$/i)).toBeInvalid());
    expect(withdrawFn).not.toHaveBeenCalled();
  });

  it('sends a valid address', async () => {
    withdrawFn.mockResolvedValue({ success: true });
    renderWithClient(<WithdrawInviteByEmailDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/^email address$/i), {
      target: { value: 'elsewhere@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^withdraw invitation$/i }));

    await waitFor(() => expect(withdrawFn).toHaveBeenCalled());
    expect(withdrawFn.mock.calls[0]?.[0]).toEqual({ email: 'elsewhere@example.com' });
  });

  it('renders nothing when closed', () => {
    renderWithClient(<WithdrawInviteByEmailDialog open={false} onOpenChange={() => {}} />);

    expect(screen.queryByRole('heading', { name: /by email address/i })).not.toBeInTheDocument();
  });
});
