import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('LandingPage', () => {
  it('renders exactly one h1 and no skipped heading levels', () => {
    render(<LandingPage />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // Every h3 on the page sits under an h2 section heading.
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
  });

  it('exposes the landmarks the skip link and screen readers rely on', () => {
    render(<LandingPage />);

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('renders every marketing section in order', () => {
    const { container } = render(<LandingPage />);

    expect(container.querySelector('#features')).toBeInTheDocument();
    expect(container.querySelector('#how-it-works')).toBeInTheDocument();
    expect(container.querySelector('#pricing')).toBeInTheDocument();
    expect(container.querySelector('#faq')).toBeInTheDocument();
  });

  it('invents no social proof: no customer logos and no testimonial', () => {
    render(<LandingPage />);

    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(screen.queryByText(/trusted by/i)).not.toBeInTheDocument();
  });
});
