import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingHero from './LandingHero';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('LandingHero', () => {
  it('renders the page h1 as a single level-1 heading', () => {
    render(<LandingHero />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Ship the product.');
    expect(heading).toHaveTextContent('Skip the plumbing.');
  });

  it('points the primary CTA at the real register route', () => {
    render(<LandingHero />);

    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/auth/register',
    );
    expect(screen.getByRole('link', { name: 'See features' })).toHaveAttribute('href', '#features');
  });

  it('hides the sample rows from assistive tech', () => {
    render(<LandingHero />);

    // The mock is an illustration; announcing sample records would be noise.
    // The names stay in the DOM, so assert they sit inside an aria-hidden
    // subtree rather than that they are absent.
    const name = screen.getByText('Engineering');
    expect(name.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('draws every sample avatar as a tint plate with its own ink', () => {
    render(<LandingHero />);

    // These were solid tone fills under white initials, which measures 1.84:1 in
    // Dark and cannot be fixed by any token value, because a Dark tone value is
    // a bright tint whose job is to be ink on a dark plate.
    // `pnpm check:contrast` asserts the tokens but cannot see which component
    // pairs which, so the call site is pinned here instead.
    const expected: [initials: string, plate: string, ink: string][] = [
      ['PR', 'bg-brand-100', 'text-brand-ink'],
      ['DE', 'bg-success-bg', 'text-success'],
      ['EN', 'bg-warning-bg', 'text-warning'],
      ['OP', 'bg-purple-bg', 'text-purple'],
      ['SU', 'bg-danger-bg', 'text-danger'],
    ];

    for (const [initials, plate, ink] of expected) {
      const avatar = screen.getByText(initials);
      expect(avatar).toHaveClass(plate);
      expect(avatar).toHaveClass(ink);
      // White on a solid tone fill is the regression this guards.
      expect(avatar).not.toHaveClass('text-brand-fg');
    }
  });
});
