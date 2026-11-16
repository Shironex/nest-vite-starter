import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StaffInviteCard from './StaffInviteCard';

const { probeFn } = vi.hoisted(() => ({ probeFn: vi.fn() }));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ token: 'tok-1' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/auth/login">{children}</a>,
}));
vi.mock('@/lib/trpc-errors', () => ({ getAppErrorCode: () => null }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      staffInviteState: { mutationOptions: (o?: object) => ({ mutationFn: probeFn, ...o }) },
      acceptStaffInvite: { mutationOptions: (o?: object) => ({ mutationFn: vi.fn(), ...o }) },
    },
  },
}));

const READY = { valid: true, requiresTwoFactor: false, movesExistingAccount: false };

/**
 * Arrange the pre-check answer and mount.
 *
 * The probe result is set HERE rather than in a `beforeEach` default, and that
 * is not a style choice. A `beforeEach` that installs `mockResolvedValue`
 * followed by a `mockRejectedValue` inside one test makes vitest report the
 * rejection as an unhandled error before the query client can claim it, and the
 * test fails on a rejection it was written to exercise.
 */
function renderCard(state: unknown = READY, { rejects = false } = {}) {
  if (rejects) probeFn.mockRejectedValue(state);
  else probeFn.mockResolvedValue(state);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StaffInviteCard />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('StaffInviteCard', () => {
  it('offers a password field, and says the next step is signing in', async () => {
    renderCard();

    expect(await screen.findByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set password/i })).toBeInTheDocument();
    expect(screen.getByText(/we will take you to sign in/i)).toBeInTheDocument();
  });

  it('asks for no 2FA code on an account that has no second factor', async () => {
    renderCard();

    await screen.findByLabelText(/^password$/i);
    expect(screen.queryByLabelText(/two-factor code/i)).not.toBeInTheDocument();
  });

  it('asks for a code when the account carries an active factor', async () => {
    renderCard({ ...READY, requiresTwoFactor: true });

    expect(await screen.findByLabelText(/two-factor code/i)).toBeInTheDocument();
  });

  it('warns that accepting closes the current organization, ABOVE the password field', async () => {
    // A consequence disclosed after the call to action is not disclosed, so
    // document order is part of the assertion rather than decoration.
    renderCard({ ...READY, movesExistingAccount: true });

    const warning = await screen.findByText(/closes the organization you are in today/i);
    const password = screen.getByLabelText(/^password$/i);

    expect(warning.compareDocumentPosition(password)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('says nothing about moving an account on the ordinary path', async () => {
    renderCard();

    await screen.findByLabelText(/^password$/i);
    expect(screen.queryByText(/closes the organization/i)).not.toBeInTheDocument();
  });

  it('replaces the form for a spent link, and points at how to get a new one', async () => {
    renderCard({ ...READY, valid: false });

    expect(await screen.findByText(/has expired or has already been used/i)).toBeInTheDocument();
    expect(screen.getByText(/ask the person who invited you/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  });

  it('offers a retry when it could not ask, rather than declaring the link dead', async () => {
    // The probe budget is per IP, so a shared office address can exhaust it for
    // somebody whose invitation is perfectly good.
    renderCard({ data: { appCode: 'RATE_LIMITED' } }, { rejects: true });

    expect(await screen.findByText(/could not check the invitation/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/has expired or/i)).not.toBeInTheDocument();
  });
});
