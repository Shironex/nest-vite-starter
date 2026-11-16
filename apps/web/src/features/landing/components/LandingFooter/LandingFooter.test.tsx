import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingFooter from './LandingFooter';

describe('LandingFooter', () => {
  it('renders a labeled footer nav with the section anchors', () => {
    render(<LandingFooter />);

    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing');
    expect(screen.getByText('© 2026 SaaS Starter')).toBeInTheDocument();
  });

  it('omits the legal links until those routes exist', () => {
    render(<LandingFooter />);

    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument();
  });
});
