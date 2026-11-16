import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UserMenu from './UserMenu';

const onLogout = vi.fn();
const onNavigateToSettings = vi.fn();
const view = {
  displayName: 'Jane Doe',
  email: 'jane@example.com',
  initials: 'JD',
  isLogoutPending: false,
  labels: {
    trigger: 'User menu: Jane Doe',
    settings: 'Settings',
    logout: 'Log out',
  },
  onLogout,
  onNavigateToSettings,
};

const useUserMenu = vi.fn(() => view as typeof view | null);

vi.mock('./UserMenu.hooks', () => ({
  useUserMenu: () => useUserMenu(),
}));

const TRIGGER = 'User menu: Jane Doe';

/** Radix opens the menu from the trigger's own keyboard handler. */
function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: TRIGGER }), { key: 'Enter' });
}

describe('UserMenu', () => {
  it('renders the user initials in the trigger', () => {
    render(<UserMenu />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('gives the icon-only trigger an accessible name carrying the user', () => {
    render(<UserMenu />);
    expect(screen.getByRole('button', { name: TRIGGER })).toBeInTheDocument();
  });

  it('renders nothing until the user profile has loaded', () => {
    useUserMenu.mockReturnValueOnce(null);
    const { container } = render(<UserMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the identity and both actions once opened', () => {
    render(<UserMenu />);
    openMenu();

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });

  it('runs the logout handler from the menu', () => {
    render(<UserMenu />);
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('routes to settings from the menu', () => {
    render(<UserMenu />);
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));

    expect(onNavigateToSettings).toHaveBeenCalledOnce();
  });
});
