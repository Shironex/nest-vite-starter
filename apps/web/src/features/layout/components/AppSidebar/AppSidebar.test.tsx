import { SidebarProvider } from '@repo/ui/sidebar';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppSidebar from './AppSidebar';

vi.mock('./AppSidebar.hooks', () => ({
  useAppSidebar: () => ({
    navLabel: 'Main navigation',
    groups: [
      {
        label: 'Main',
        items: [
          { title: 'Dashboard', href: '/dashboard', icon: () => null, isActive: true },
          { title: 'Workspaces', href: '/workspaces', icon: () => null, isActive: false },
          { title: 'Audit log', href: '/audit', icon: () => null, isActive: false },
        ],
      },
      {
        label: 'Settings',
        items: [{ title: 'Settings', href: '/settings', icon: () => null, isActive: false }],
      },
    ],
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/features/layout/components/OrganizationIdentity', () => ({
  OrganizationIdentity: () => <div data-testid="organization-identity" />,
}));

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

describe('AppSidebar', () => {
  it('renders every nav item supplied by the hook', () => {
    renderSidebar();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Audit log')).toBeInTheDocument();
  });

  it('renders each group under its own heading', () => {
    renderSidebar();
    // Queried by slot: a group label can repeat an item title (Settings).
    const labels = document.querySelectorAll('[data-slot="sidebar-group-label"]');
    expect([...labels].map((label) => label.textContent)).toEqual(['Main', 'Settings']);
  });

  it('renders the app brand label', () => {
    renderSidebar();
    expect(screen.getByText(PRODUCT_NAME)).toBeInTheDocument();
  });

  it('renders the organization identity block in the footer slot', () => {
    renderSidebar();
    expect(screen.getByTestId('organization-identity')).toBeInTheDocument();
  });

  it('exposes a named navigation landmark holding the links', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByText('Dashboard')).toBeInTheDocument();
  });

  it('marks only the active entry with aria-current', () => {
    renderSidebar();
    const active = screen.getByText('Dashboard').closest('a');
    const inactive = screen.getByText('Workspaces').closest('a');
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(inactive).not.toHaveAttribute('aria-current');
  });

  it('ships no disabled placeholder entries', () => {
    renderSidebar();
    const disabled = document.querySelectorAll('[aria-disabled="true"]');
    expect(disabled).toHaveLength(0);
  });

  /** The `data-tour` anchor the orientation tour's first step points at. */
  it('carries the data-tour anchor the orientation tour points at', () => {
    const { container } = renderSidebar();

    expect(container.querySelector('[data-tour="app-sidebar"]')).not.toBeNull();
  });
});
