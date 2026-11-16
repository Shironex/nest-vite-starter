import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingCta from './LandingCta';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('LandingCta', () => {
  it('renders the closing heading and routes the CTA to register', () => {
    render(<LandingCta />);

    expect(
      screen.getByRole('heading', { level: 2, name: /start building today/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/auth/register',
    );
  });
});
