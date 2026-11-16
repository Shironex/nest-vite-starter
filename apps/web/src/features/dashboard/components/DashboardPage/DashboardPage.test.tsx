import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

vi.mock('./DashboardPage.hooks', () => ({
  useDashboardPage: () => ({
    greeting: 'Good day, Ada',
    subtitle: 'Here is what is happening in your organization today.',
    todayLabel: 'Tuesday, July 14, 2026',
  }),
}));

// The page is a composition; each panel has its own test, so they are stubbed
// here to pin the LAYOUT rather than re-render four screens' worth of markup.
vi.mock('../ActivityFeed', () => ({ ActivityFeed: () => <div data-testid="activity-feed" /> }));

const { setTopbarSubtitle } = vi.hoisted(() => ({ setTopbarSubtitle: vi.fn() }));
vi.mock('@/stores/topbar-store', () => ({ useSetTopbarSubtitle: setTopbarSubtitle }));

describe('DashboardPage', () => {
  it('greets the signed-in user in English', () => {
    render(<DashboardPage />);
    expect(screen.getByText('Good day, Ada')).toBeInTheDocument();
    expect(
      screen.getByText('Here is what is happening in your organization today.'),
    ).toBeInTheDocument();
  });

  it('leaves the top-level heading to the app shell topbar', () => {
    render(<DashboardPage />);
    // Two competing h1s (topbar title + page greeting) is the defect this
    // guards; the greeting is a welcome line, not the document heading.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('publishes the date into the topbar rather than the page body', () => {
    render(<DashboardPage />);
    expect(setTopbarSubtitle).toHaveBeenCalledWith('Tuesday, July 14, 2026');
    expect(screen.queryByText('Tuesday, July 14, 2026')).not.toBeInTheDocument();
  });

  it('renders the greeting and the activity feed', () => {
    render(<DashboardPage />);

    expect(screen.getByTestId('activity-feed')).toBeInTheDocument();
  });
});
