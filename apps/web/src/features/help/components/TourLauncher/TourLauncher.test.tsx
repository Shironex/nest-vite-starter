import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITourLauncherView } from './TourLauncher.types';
import TourLauncher from './TourLauncher';

const view = vi.hoisted(() => ({
  current: {
    isAvailable: true,
    label: 'Help',
    tooltip: 'Dashboard: first steps',
    isRunning: false,
    onStart: vi.fn(),
  } as ITourLauncherView,
}));

vi.mock('./TourLauncher.hooks', () => ({
  useTourLauncher: () => view.current,
}));

beforeEach(() => {
  view.current = {
    isAvailable: true,
    label: 'Help',
    tooltip: 'Dashboard: first steps',
    isRunning: false,
    onStart: vi.fn(),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TourLauncher', () => {
  it('renders a named control, so a screen reader is not offered a bare icon', () => {
    render(<TourLauncher />);

    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('carries the app-help anchor, so the orientation tour can point at itself', () => {
    render(<TourLauncher />);

    expect(screen.getByRole('button', { name: 'Help' })).toHaveAttribute('data-tour', 'app-help');
  });

  it('starts the tour on click', () => {
    render(<TourLauncher />);

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    expect(view.current.onStart).toHaveBeenCalledTimes(1);
  });

  /**
   * A screen with no tour, and a screen whose tour has no anchor in the DOM,
   * both resolve to unavailable. The control is ABSENT rather than disabled:
   * a greyed-out help button is a promise the screen cannot keep.
   */
  it('renders nothing when the screen has no runnable tour', () => {
    view.current = { ...view.current, isAvailable: false };

    render(<TourLauncher />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  /**
   * Marked busy, NOT disabled. A disabled button is blurred, and the element
   * focus has to return to when the tour ends is the button that started it.
   * A second start is refused in the hook, and the driver overlay covers the
   * control anyway, so disabling would cost the focus and buy nothing.
   */
  it('marks itself busy while a tour runs, and stays focusable', () => {
    view.current = { ...view.current, isRunning: true };

    render(<TourLauncher />);

    const button = screen.getByRole('button', { name: 'Help' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeEnabled();
  });
});
