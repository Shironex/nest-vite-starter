import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingSteps from './LandingSteps';

describe('LandingSteps', () => {
  it('renders the three onboarding steps in order', () => {
    render(<LandingSteps />);

    const titles = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(titles).toEqual(['Create an account', 'Set up your organization', 'Stay in control']);
  });

  it('uses an ordered list so the sequence survives without the numerals', () => {
    render(<LandingSteps />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
