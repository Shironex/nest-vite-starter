import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ThemeSection from './ThemeSection';

describe('ThemeSection', () => {
  it('renders the card title', () => {
    render(<ThemeSection />);
    expect(screen.getByText('Appearance')).toBeInTheDocument();
  });

  it('renders the theme label', () => {
    render(<ThemeSection />);
    expect(screen.getByText('Theme')).toBeInTheDocument();
  });
});
