import { SidebarProvider } from '@repo/ui/sidebar';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppTopbar from './AppTopbar';

const useAppTopbar = vi.fn(() => ({ title: 'Dashboard', subtitle: null as string | null }));

vi.mock('./AppTopbar.hooks', () => ({
  useAppTopbar: () => useAppTopbar(),
}));

vi.mock('@/features/layout/components/ConnectionIndicator', () => ({
  ConnectionIndicator: () => <span data-testid="connection-indicator" />,
}));

vi.mock('@/features/layout/components/UserMenu', () => ({
  UserMenu: () => <button type="button">User menu</button>,
}));

function renderTopbar() {
  return render(
    <SidebarProvider>
      <AppTopbar notifications={<button type="button">Notifications</button>} />
    </SidebarProvider>,
  );
}

describe('AppTopbar', () => {
  it('renders the page title for the current route', () => {
    renderTopbar();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('is a banner landmark', () => {
    renderTopbar();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  /*
   * The shell half of the one-h1-per-route invariant: this component is the
   * only thing inside `_authenticated` allowed to render one. The other half,
   * that no page adds a second, is a property of the composed document, so it
   * is pinned per route by `e2e/app-shell-headings.spec.ts`.
   */
  it('renders the title as the one and only h1', () => {
    renderTopbar();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard');
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('omits the subtitle line when the route supplies none', () => {
    renderTopbar();
    // The subtitle is the only `<p>` left in the banner now that the title is
    // an `<h1>`, so its absence is the count going to zero.
    expect(screen.getByRole('banner').querySelectorAll('p')).toHaveLength(0);
  });

  it('renders the subtitle when the route supplies one', () => {
    useAppTopbar.mockReturnValueOnce({ title: 'Workspaces', subtitle: '12 workspaces' });
    renderTopbar();
    expect(screen.getByText('12 workspaces')).toBeInTheDocument();
  });

  it('keeps the sidebar trigger, connection status and notifications', () => {
    renderTopbar();
    expect(screen.getByRole('button', { name: /sidebar/i })).toBeInTheDocument();
    expect(screen.getByTestId('connection-indicator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'User menu' })).toBeInTheDocument();
  });
});
