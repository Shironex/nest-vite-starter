import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PRODUCT_NAME } from '@repo/shared/constants';
import LandingPage from './LandingPage';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('LandingPage', () => {
  it('names the product from PRODUCT_NAME in its only h1', () => {
    render(<LandingPage />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(PRODUCT_NAME);
  });

  it('offers sign in and account creation, from the header and the hero', () => {
    render(<LandingPage />);

    const header = screen.getByRole('banner');
    expect(header.querySelector('a[href="/auth/login"]')).toHaveTextContent('Sign in');
    expect(header.querySelector('a[href="/auth/register"]')).toHaveTextContent('Create account');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/auth/register',
    );
  });

  it('exposes the landmarks the skip link and screen readers rely on', () => {
    render(<LandingPage />);

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent(PRODUCT_NAME);
  });

  it('carries no marketing sections: no pricing, FAQ or invented social proof', () => {
    render(<LandingPage />);

    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/trusted by/i)).not.toBeInTheDocument();
  });
});
