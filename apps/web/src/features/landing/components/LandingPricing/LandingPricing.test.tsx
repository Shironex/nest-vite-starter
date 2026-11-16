import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPricing from './LandingPricing';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('LandingPricing', () => {
  it('renders the three plans', () => {
    render(<LandingPricing />);

    expect(screen.getByRole('heading', { level: 3, name: 'Starter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Enterprise' })).toBeInTheDocument();
  });

  it('states no price until pricing is actually decided', () => {
    render(<LandingPricing />);

    // Naming a figure publicly is a commercial commitment the starter cannot
    // make for you.
    expect(screen.queryByText(/[$€£]\s?\d/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Coming soon')).toHaveLength(3);
  });

  it('sends every plan to the register route', () => {
    render(<LandingPricing />);

    const signupLinks = screen.getAllByRole('link', { name: 'Create an account' });
    expect(signupLinks).toHaveLength(3);
    signupLinks.forEach((link) => expect(link).toHaveAttribute('href', '/auth/register'));
  });

  it('ships no mailto CTA, which would be a dead link until a real address exists', () => {
    const { container } = render(<LandingPricing />);

    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('marks only the Team plan as featured', () => {
    render(<LandingPricing />);

    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Team' }).closest('li')).toHaveClass(
      'border-brand',
    );
  });
});
