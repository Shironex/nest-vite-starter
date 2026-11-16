import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActivityFeed from './ActivityFeed';
import type { IActivityFeedRow } from './ActivityFeed.types';

const state = vi.hoisted(() => ({
  rows: [] as IActivityFeedRow[],
  isLoading: false,
  hasError: false,
  isEmpty: false,
  showTestControl: false,
}));

const onSendTestNotification = vi.fn();

vi.mock('./ActivityFeed.hooks', () => ({
  useActivityFeed: () => ({
    rows: state.rows,
    isLoading: state.isLoading,
    hasError: state.hasError,
    isEmpty: state.isEmpty,
    showTestControl: state.showTestControl,
    labels: {
      title: 'Activity feed',
      subtitle: 'The latest events in the system',
      empty: 'No recent activity',
      emptyHint: 'Events from the app show up here as they arrive.',
      loadError: 'Could not load the activity',
      retry: 'Try again',
      testNotification: 'Send a test notification',
    },
    onSendTestNotification,
  }),
}));

const row: IActivityFeedRow = {
  id: 'n1',
  title: 'New workspace: Acme Inc.',
  message: 'The record was created.',
  timeLabel: '5 min temu',
  tone: 'success',
  isUnread: true,
};

function reset() {
  state.rows = [];
  state.isLoading = false;
  state.hasError = false;
  state.isEmpty = false;
  state.showTestControl = false;
}

describe('ActivityFeed', () => {
  it('renders a title, a message and a relative time per row', () => {
    reset();
    state.rows = [row];
    render(<ActivityFeed />);

    expect(screen.getByText('New workspace: Acme Inc.')).toBeInTheDocument();
    expect(screen.getByText('The record was created.')).toBeInTheDocument();
    expect(screen.getByText('5 min temu')).toBeInTheDocument();
  });

  it('keeps the live region mounted so an arriving row is announced', () => {
    reset();
    state.isEmpty = true;
    render(<ActivityFeed />);

    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
  });

  it('shows skeletons while the history read is in flight, not the empty copy', () => {
    reset();
    state.isLoading = true;
    render(<ActivityFeed />);

    // The defect this pins: the feed used to render "No recent
    // activity" on every page load because it had no history read at all.
    expect(screen.queryByText('No recent activity')).not.toBeInTheDocument();
  });

  it('shows the empty state only once the read has resolved with nothing', () => {
    reset();
    state.isEmpty = true;
    render(<ActivityFeed />);

    expect(screen.getByText('No recent activity')).toBeInTheDocument();
  });

  it('reports a failed read instead of showing it as no activity', () => {
    reset();
    state.hasError = true;
    render(<ActivityFeed />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the activity');
    expect(screen.queryByText('No recent activity')).not.toBeInTheDocument();
  });

  it('hides the test-notification control outside development', () => {
    reset();
    render(<ActivityFeed />);

    expect(
      screen.queryByRole('button', { name: 'Send a test notification' }),
    ).not.toBeInTheDocument();
  });

  it('sends a test notification from the development control', () => {
    reset();
    state.showTestControl = true;
    render(<ActivityFeed />);

    fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));
    expect(onSendTestNotification).toHaveBeenCalledOnce();
  });
});
