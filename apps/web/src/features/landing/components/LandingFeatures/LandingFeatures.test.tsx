import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingFeatures from './LandingFeatures';

describe('LandingFeatures', () => {
  it('renders all six cells under a level-2 section heading', () => {
    render(<LandingFeatures />);

    expect(
      screen.getByRole('heading', { level: 2, name: /everything a saas needs/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6);
  });

  it('anchors the section so the nav link can reach it', () => {
    const { container } = render(<LandingFeatures />);
    expect(container.querySelector('#features')).toBeInTheDocument();
  });

  it('gives the signature cell the inverted surface and the first cell the brand tint', () => {
    render(<LandingFeatures />);

    const signature = screen.getByRole('heading', { name: 'Session control' }).closest('li');
    const tint = screen.getByRole('heading', { name: 'Accounts and sessions' }).closest('li');
    const plain = screen.getByRole('heading', { name: 'Organizations' }).closest('li');

    expect(signature).toHaveClass('bg-text');
    expect(tint).toHaveClass('bg-brand-50');
    expect(plain).toHaveClass('bg-surface');
  });
});
