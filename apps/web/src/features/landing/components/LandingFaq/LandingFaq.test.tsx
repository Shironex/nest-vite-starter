import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingFaq from './LandingFaq';

describe('LandingFaq', () => {
  it('starts with the first question expanded and the rest collapsed', () => {
    render(<LandingFaq />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true');
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'false');
  });

  it('wires every question to the panel it controls', () => {
    render(<LandingFaq />);

    const button = screen.getByRole('button', { name: /included out of the box/i });
    const panelId = button.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId as string)).toBeInTheDocument();
  });

  it('opens the clicked question and closes the previously open one', () => {
    render(<LandingFaq />);

    const importQuestion = screen.getByRole('button', { name: /import data/i });
    fireEvent.click(importQuestion);

    expect(importQuestion).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /included out of the box/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('collapses an open question when it is clicked again', () => {
    render(<LandingFaq />);

    const first = screen.getByRole('button', { name: /included out of the box/i });
    fireEvent.click(first);

    expect(first).toHaveAttribute('aria-expanded', 'false');
  });
});
