import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SecurityCard from './SecurityCard';

const { status } = vi.hoisted(() => ({
  status: { value: undefined as unknown, loading: false },
}));

vi.mock('../../TwoFactor.queries', () => ({
  useTwoFactorStatus: () => ({ data: status.value, isLoading: status.loading }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    twoFactor: {
      status: { queryOptions: () => ({ queryKey: ['twoFactor.status'] }) },
      revokeTrustedDevices: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      disable: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      regenerateRecoveryCodes: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      beginEnrollment: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      activate: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
  resetCsrfToken: vi.fn(),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const POLICY = { required: false, graceEndsAt: null, enforced: false };

afterEach(() => {
  status.value = undefined;
  status.loading = false;
});

describe('SecurityCard', () => {
  it('offers to enable 2FA when it is off', () => {
    status.value = {
      enabled: false,
      methods: [],
      recoveryCodesRemaining: 0,
      lowRecoveryCodes: false,
      pendingEnrollment: false,
      trustedDeviceCount: 0,
      policy: POLICY,
    };
    renderWithClient(<SecurityCard />);
    expect(
      screen.getByRole('button', { name: /enable two-factor authentication/i }),
    ).toBeInTheDocument();
  });

  it('shows management actions and the low-codes nag when enabled', () => {
    status.value = {
      enabled: true,
      methods: ['TOTP'],
      recoveryCodesRemaining: 2,
      lowRecoveryCodes: true,
      pendingEnrollment: false,
      trustedDeviceCount: 3,
      policy: POLICY,
    };
    renderWithClient(<SecurityCard />);
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /turn off two-factor/i })).toBeInTheDocument();
    expect(screen.getByText(/running low on recovery codes/i)).toBeInTheDocument();
  });

  /*
   * The design draws an "Active sessions" row next to these two. There is no
   * procedure that lists sessions, so the row must stay absent rather than
   * showing an invented device count.
   */
  it('does not claim to list active sessions', () => {
    status.value = {
      enabled: true,
      methods: ['TOTP'],
      recoveryCodesRemaining: 8,
      lowRecoveryCodes: false,
      pendingEnrollment: false,
      trustedDeviceCount: 1,
      policy: POLICY,
    };
    renderWithClient(<SecurityCard />);
    expect(screen.queryByText(/active sessions/i)).not.toBeInTheDocument();
    expect(screen.getByText(/browser may skip the second step/i)).toBeInTheDocument();
  });
});

/**
 * The header badge waits for the query.
 *
 * Rendered from `status?.enabled ?? false` it said "Off" to a user who
 * HAS 2FA on, for the length of the fetch, then flipped to the green
 * "On": the card stated the opposite of the truth about their own
 * account security before correcting itself.
 */
describe('SecurityCard status badge while loading', () => {
  it('shows a placeholder rather than claiming 2FA is off', () => {
    status.value = undefined;
    status.loading = true;
    const { container } = renderWithClient(<SecurityCard />);

    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    expect(screen.queryByText('On')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('states the real value once the status arrives', () => {
    status.value = {
      enabled: true,
      methods: ['TOTP'],
      recoveryCodesRemaining: 8,
      lowRecoveryCodes: false,
      pendingEnrollment: false,
      trustedDeviceCount: 0,
      policy: POLICY,
    };
    renderWithClient(<SecurityCard />);

    expect(screen.getByText('On')).toBeInTheDocument();
  });
});
