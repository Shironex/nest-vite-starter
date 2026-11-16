import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OrgTwoFactorPolicyCard from './OrgTwoFactorPolicyCard';
import type { IOrgTwoFactorPolicyCardView } from './OrgTwoFactorPolicyCard.types';

const baseView: IOrgTwoFactorPolicyCardView = {
  policy: { required: false, graceEndsAt: null, enforced: false },
  isLoading: false,
  required: false,
  enforced: false,
  statusText: 'Not required',
  deadlineText: null,
  confirmEnableOpen: false,
  onConfirmEnableOpenChange: vi.fn(),
  onToggle: vi.fn(),
  onConfirmEnable: vi.fn(),
  isPending: false,
};

let current: IOrgTwoFactorPolicyCardView = baseView;
vi.mock('./OrgTwoFactorPolicyCard.hooks', () => ({
  useOrgTwoFactorPolicyCard: () => current,
}));

describe('OrgTwoFactorPolicyCard', () => {
  it('renders an off state when 2FA is not required', () => {
    current = { ...baseView };
    render(<OrgTwoFactorPolicyCard />);
    expect(screen.getByText('Not required')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('shows the deadline and an enforcing badge once past grace', () => {
    current = {
      ...baseView,
      required: true,
      enforced: true,
      statusText: 'Required for all members',
      deadlineText: 'Members must enroll by Jul 28, 2026',
    };
    render(<OrgTwoFactorPolicyCard />);
    expect(screen.getByText('Required for all members')).toBeInTheDocument();
    expect(screen.getByText(/Members must enroll by/)).toBeInTheDocument();
    expect(screen.getByText('Enforcing')).toBeInTheDocument();
  });

  it('toggling the switch calls onToggle with the next value', () => {
    const onToggle = vi.fn();
    current = { ...baseView, onToggle };
    render(<OrgTwoFactorPolicyCard />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

/**
 * The header badge waits for getTenantPolicy.
 *
 * `required` and `enforced` both default to false while the query runs, so an
 * admin of a tenant that ENFORCES 2FA saw "Off" on every open of the
 * panel before it flipped to "Enforcing": the card stated the opposite of
 * the policy it exists to report.
 */
describe('OrgTwoFactorPolicyCard badge while loading', () => {
  it('shows a placeholder rather than claiming the policy is off', () => {
    current = { ...baseView, isLoading: true, policy: undefined };
    const { container } = render(<OrgTwoFactorPolicyCard />);

    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    expect(screen.queryByText('Enforcing')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
