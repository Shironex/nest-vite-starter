import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingNav from './LandingNav';

// The nav only needs `Link` to render an anchor; a RouterProvider would pull in
// the whole route tree for what is a presentational header.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('LandingNav', () => {
  it('renders the wordmark and both auth CTAs', () => {
    render(<LandingNav />);

    expect(screen.getByText('SaaS Starter')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sign up' })[0]).toHaveAttribute(
      'href',
      '/auth/register',
    );
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute(
      'href',
      '/auth/login',
    );
  });

  it('links every section anchor', () => {
    render(<LandingNav />);

    expect(screen.getAllByRole('link', { name: 'Pricing' })[0]).toHaveAttribute('href', '#pricing');
    expect(screen.getAllByRole('link', { name: 'How it works' })[0]).toHaveAttribute(
      'href',
      '#how-it-works',
    );
  });

  it('starts with the mobile menu collapsed and toggles it open', () => {
    render(<LandingNav />);

    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    const openToggle = screen.getByRole('button', { name: 'Close menu' });
    expect(openToggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the mobile menu after following a link', () => {
    render(<LandingNav />);

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    const mobileNav = screen.getByRole('navigation', { name: 'Main (mobile)' });
    fireEvent.click(within(mobileNav).getByRole('link', { name: 'FAQ' }));

    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
