import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GraceBanner from './GraceBanner';

const { statusData } = vi.hoisted(() => ({ statusData: { value: undefined as unknown } }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to}>{children}</a>,
}));

vi.mock('../../TwoFactor.queries', () => ({
  useTwoFactorStatus: () => ({ data: statusData.value }),
}));

afterEach(() => {
  statusData.value = undefined;
});

describe('GraceBanner', () => {
  it('renders nothing when 2FA is not required', () => {
    statusData.value = {
      enabled: false,
      policy: { required: false, enforced: false, graceEndsAt: null },
    };
    const { container } = render(<GraceBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nags during the grace window with a link to the security row', () => {
    statusData.value = {
      enabled: false,
      policy: { required: true, enforced: false, graceEndsAt: new Date('2026-08-01') },
    };
    render(<GraceBanner />);
    expect(screen.getByText(/two-factor authentication is required/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set up now/i })).toHaveAttribute(
      'href',
      '/settings?section=security',
    );
  });
});
