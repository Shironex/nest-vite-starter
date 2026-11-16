import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

vi.mock('./DashboardPage.hooks', () => ({
  useDashboardPage: () => ({
    greeting: 'Good day, Ada',
    subtitle: 'Here is what is happening in your account today.',
    todayLabel: 'Tuesday, July 14, 2026',
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search?: { section?: string };
    children: React.ReactNode;
  }) => (
    <a href={search?.section ? `${to}?section=${search.section}` : to} {...props}>
      {children}
    </a>
  ),
}));

const { setTopbarSubtitle } = vi.hoisted(() => ({ setTopbarSubtitle: vi.fn() }));
vi.mock('@/stores/topbar-store', () => ({ useSetTopbarSubtitle: setTopbarSubtitle }));

describe('DashboardPage', () => {
  it('greets the signed-in user in English', () => {
    render(<DashboardPage />);
    expect(screen.getByText('Good day, Ada')).toBeInTheDocument();
    expect(
      screen.getByText('Here is what is happening in your account today.'),
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

  it('shows a start-here card in place of invented tiles', () => {
    render(<DashboardPage />);
    expect(screen.getByText('Start here')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Turn on two-factor sign-in' })).toHaveAttribute(
      'href',
      '/settings?section=security',
    );
  });
});
