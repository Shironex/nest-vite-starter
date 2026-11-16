import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UsersSection from './UsersSection';

const { listUsersFn, currentUser } = vi.hoisted(() => ({
  listUsersFn: vi.fn(),
  currentUser: { id: 'u-self' },
}));

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: currentUser }) }));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: { list: { pathFilter: () => ({ queryKey: ['audit', 'list'] }) } },
    user: {
      listUsers: {
        queryOptions: (input?: unknown) => ({
          queryKey: ['user', 'listUsers', input],
          queryFn: () => listUsersFn(input),
        }),
        pathFilter: () => ({ queryKey: ['user', 'listUsers'] }),
      },
      updateUserRole: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      unlockUser: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      adminDeleteUser: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      disableUser: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      enableUser: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      revokeUserSessions: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
    twoFactor: {
      resetUserTwoFactor: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const admin = {
  id: 'u-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  role: 'ADMIN',
  emailVerified: true,
  lockedUntil: null,
  createdAt: new Date(),
  twoFactorEnabled: true,
  disabledAt: null,
  status: 'active' as const,
};

const lockedUser = {
  id: 'u-2',
  email: 'bob@example.com',
  displayName: null,
  role: 'USER',
  emailVerified: false,
  lockedUntil: new Date(Date.now() + 60 * 60 * 1000),
  createdAt: new Date(),
  twoFactorEnabled: false,
  disabledAt: null,
  status: 'active' as const,
};

/** Disabled by an admin. Can be enabled again. */
const removedUser = {
  ...lockedUser,
  id: 'u-4',
  email: 'dave@example.com',
  lockedUntil: null,
  disabledAt: new Date('2026-05-01T00:00:00Z'),
  status: 'disabled' as const,
};

/** Radix opens the menu from the trigger's own keyboard handler. */
function openRowMenu(email: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `Actions for ${email}` }), { key: 'Enter' });
}

afterEach(() => {
  vi.clearAllMocks();
  currentUser.id = 'u-self';
});

describe('UsersSection', () => {
  it('renders users with their 2FA status badges', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<UsersSection />);

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('marks only the locked user with the locked badge', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<UsersSection />);

    await screen.findByText('alice@example.com');
    expect(screen.getAllByText('Locked')).toHaveLength(1);
  });

  it('offers neither unlock nor delete for an unlocked admin', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<UsersSection />);

    await screen.findByText('alice@example.com');
    openRowMenu('alice@example.com');

    expect(screen.getByRole('menuitem', { name: 'Change role' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reset two-factor' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Unlock account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete account' })).not.toBeInTheDocument();
  });

  it('offers unlock and delete for a locked regular user', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<UsersSection />);

    await screen.findByText('bob@example.com');
    openRowMenu('bob@example.com');

    expect(screen.getByRole('menuitem', { name: 'Unlock account' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('opens the reset dialog for the chosen user', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<UsersSection />);

    await screen.findByText('alice@example.com');
    openRowMenu('alice@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset two-factor' }));

    expect(
      await screen.findByRole('heading', { name: /reset two-factor for this user/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reset two-factor$/i })).toBeInTheDocument();
  });

  it('opens the change-role dialog for the chosen user', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<UsersSection />);

    await screen.findByText('alice@example.com');
    openRowMenu('alice@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change role' }));

    expect(
      await screen.findByRole('heading', { name: /change this user's role/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/from "Administrator" to "User"/)).toBeInTheDocument();
  });

  it('opens the unlock dialog for a locked user', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<UsersSection />);

    await screen.findByText('bob@example.com');
    openRowMenu('bob@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unlock account' }));

    expect(
      await screen.findByRole('heading', { name: /unlock this account/i }),
    ).toBeInTheDocument();
  });

  it('opens the delete dialog for a regular user', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<UsersSection />);

    await screen.findByText('bob@example.com');
    openRowMenu('bob@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));

    expect(
      await screen.findByRole('heading', { name: /delete this account/i }),
    ).toBeInTheDocument();
  });

  describe('the two account states', () => {
    const everyone = [admin, lockedUser, removedUser];

    it('labels each row with the state it is actually in', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<UsersSection />);

      await screen.findByText('dave@example.com');
      expect(screen.getAllByText('Active')).toHaveLength(2);
      expect(screen.getByText('Account disabled')).toBeInTheDocument();
    });

    it('offers enable to a disabled account, and not disable again', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<UsersSection />);

      await screen.findByText('dave@example.com');
      openRowMenu('dave@example.com');

      expect(screen.getByRole('menuitem', { name: 'Enable account' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Disable account' })).not.toBeInTheDocument();
    });

    it('offers disable to an active regular user', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<UsersSection />);

      await screen.findByText('bob@example.com');
      openRowMenu('bob@example.com');

      expect(screen.getByRole('menuitem', { name: 'Disable account' })).toBeInTheDocument();
    });

    it('never offers to disable or delete an admin', async () => {
      // Both are refused by guards on the server. A button that always errors
      // is worse than no button.
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<UsersSection />);

      await screen.findByText('alice@example.com');
      openRowMenu('alice@example.com');

      expect(screen.queryByRole('menuitem', { name: 'Disable account' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Delete account' })).not.toBeInTheDocument();
    });

    it('opens the enable dialog for a disabled account', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<UsersSection />);

      await screen.findByText('dave@example.com');
      openRowMenu('dave@example.com');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Enable account' }));

      expect(
        await screen.findByRole('heading', { name: /enable this account/i }),
      ).toBeInTheDocument();
    });
  });

  describe("the signed-in admin's own row", () => {
    it('is marked as you and offers nothing the self guards refuse', async () => {
      listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
      currentUser.id = 'u-1';
      renderWithClient(<UsersSection />);

      await screen.findByText('alice@example.com');
      expect(screen.getByText('You')).toBeInTheDocument();
      openRowMenu('alice@example.com');

      expect(screen.queryByRole('menuitem', { name: 'Change role' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: 'Sign out everywhere' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Disable account' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Delete account' })).not.toBeInTheDocument();
      // Your own 2FA is turned off in the security settings, with a password
      // and a code, never through the admin reset.
      expect(screen.queryByRole('menuitem', { name: 'Reset two-factor' })).not.toBeInTheDocument();
    });
  });

  it('opens the sign-out-everywhere dialog for another user', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    currentUser.id = 'u-1';
    renderWithClient(<UsersSection />);

    await screen.findByText('bob@example.com');
    openRowMenu('bob@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out everywhere' }));

    expect(
      await screen.findByRole('heading', { name: /sign this user out everywhere/i }),
    ).toBeInTheDocument();
  });
});
