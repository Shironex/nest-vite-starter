import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHelpToursSectionView } from './HelpToursSection.types';
import HelpToursSection from './HelpToursSection';

const view = vi.hoisted(() => ({ current: {} as IHelpToursSectionView }));

vi.mock('./HelpToursSection.hooks', () => ({
  useHelpToursSection: () => view.current,
}));

const LABELS = {
  title: 'Help and tours',
  description: "Short tours of the app's screens.",
  columnTour: 'Tour',
  columnScreen: 'Screen',
  columnStatus: 'Status',
  replay: 'Replay',
  resetAll: 'Show them all again',
  loadError: 'The tour state could not be loaded.',
};

beforeEach(() => {
  view.current = {
    rows: [
      {
        id: 'dashboard',
        name: 'Dashboard: first steps',
        route: '/dashboard',
        status: 'completed',
        statusLabel: 'Seen 08/28/2026',
      },
      {
        id: 'workspaces',
        name: 'Workspaces: list and filters',
        route: '/workspaces',
        status: 'unseen',
        statusLabel: 'Not seen yet',
      },
    ],
    isLoading: false,
    hasLoadError: false,
    isResetting: false,
    labels: LABELS,
    onReplay: vi.fn(),
    onResetAll: vi.fn(),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('HelpToursSection', () => {
  it('lists every tour with its screen and its status', () => {
    render(<HelpToursSection />);

    expect(screen.getByText('Dashboard: first steps')).toBeInTheDocument();
    expect(screen.getByText('/workspaces')).toBeInTheDocument();
    expect(screen.getByText('Not seen yet')).toBeInTheDocument();
  });

  /**
   * A tour that can only be seen once is onboarding, not help. Every row is
   * replayable regardless of whether it has been completed, which is the whole
   * of "replayable for everyone using the app as help".
   */
  it('offers a replay on a completed tour as well as an unseen one', () => {
    render(<HelpToursSection />);

    expect(screen.getAllByRole('button', { name: /Replay/u })).toHaveLength(2);
  });

  it('names each replay control after its tour, so two rows are distinguishable', () => {
    render(<HelpToursSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Replay: Workspaces: list and filters' }));

    expect(view.current.onReplay).toHaveBeenCalledWith('workspaces');
  });

  it('resets every tour at once', () => {
    render(<HelpToursSection />);

    fireEvent.click(screen.getByRole('button', { name: /Show them all again/u }));

    expect(view.current.onResetAll).toHaveBeenCalledTimes(1);
  });

  it('shows the read failure instead of an empty table', () => {
    view.current = { ...view.current, hasLoadError: true };

    render(<HelpToursSection />);

    expect(screen.getByText(LABELS.loadError)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
