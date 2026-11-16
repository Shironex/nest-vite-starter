import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MembersSection from './MembersSection';

const { listUsersFn } = vi.hoisted(() => ({
  listUsersFn: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
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
      removeMember: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      restoreMember: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
    twoFactor: {
      resetMemberTwoFactor: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
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
  membershipEndedAt: null,
  isOwner: true,
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
  membershipEndedAt: null,
  isOwner: false,
  status: 'active' as const,
};

/** Was a member, no longer is. Restorable. */
const removedMember = {
  ...lockedUser,
  id: 'u-4',
  email: 'dave@example.com',
  lockedUntil: null,
  membershipEndedAt: new Date('2026-05-01T00:00:00Z'),
  status: 'removed' as const,
};

/** Radix opens the menu from the trigger's own keyboard handler. */
function openRowMenu(email: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `Actions for ${email}` }), { key: 'Enter' });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('MembersSection', () => {
  it('renders members with their 2FA status badges', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<MembersSection />);

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('marks only the locked member with the locked badge', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<MembersSection />);

    await screen.findByText('alice@example.com');
    expect(screen.getAllByText('Locked')).toHaveLength(1);
  });

  it('offers neither unlock nor delete for an unlocked admin', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<MembersSection />);

    await screen.findByText('alice@example.com');
    openRowMenu('alice@example.com');

    expect(screen.getByRole('menuitem', { name: 'Change role' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reset two-factor' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Unlock account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete account' })).not.toBeInTheDocument();
  });

  it('offers unlock and delete for a locked regular user', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<MembersSection />);

    await screen.findByText('bob@example.com');
    openRowMenu('bob@example.com');

    expect(screen.getByRole('menuitem', { name: 'Unlock account' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('opens the reset dialog for the chosen member', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<MembersSection />);

    await screen.findByText('alice@example.com');
    openRowMenu('alice@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset two-factor' }));

    expect(
      await screen.findByRole('heading', { name: /reset two-factor for this member/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reset two-factor$/i })).toBeInTheDocument();
  });

  it('opens the change-role dialog for the chosen member', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<MembersSection />);

    await screen.findByText('alice@example.com');
    openRowMenu('alice@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change role' }));

    expect(
      await screen.findByRole('heading', { name: /change this member's role/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/from "Administrator" to "User"/)).toBeInTheDocument();
  });

  it('opens the unlock dialog for a locked member', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<MembersSection />);

    await screen.findByText('bob@example.com');
    openRowMenu('bob@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unlock account' }));

    expect(
      await screen.findByRole('heading', { name: /unlock this account/i }),
    ).toBeInTheDocument();
  });

  it('opens the delete dialog for a regular member', async () => {
    listUsersFn.mockResolvedValue({ items: [admin, lockedUser], nextCursor: null });
    renderWithClient(<MembersSection />);

    await screen.findByText('bob@example.com');
    openRowMenu('bob@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));

    expect(
      await screen.findByRole('heading', { name: /delete this account/i }),
    ).toBeInTheDocument();
  });

  describe('the two membership states', () => {
    const everyone = [admin, lockedUser, removedMember];

    it('labels each row with the state it is actually in', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<MembersSection />);

      await screen.findByText('dave@example.com');
      expect(screen.getAllByText('Active')).toHaveLength(2);
      expect(screen.getByText('Removed from organization')).toBeInTheDocument();
    });

    it('marks the owner, and only the owner', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<MembersSection />);

      await screen.findByText('alice@example.com');
      expect(screen.getAllByText('Owner')).toHaveLength(1);
    });

    it('offers restore to a removed member, and not removal again', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<MembersSection />);

      await screen.findByText('dave@example.com');
      openRowMenu('dave@example.com');

      expect(screen.getByRole('menuitem', { name: 'Restore to organization' })).toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: 'Remove from organization' }),
      ).not.toBeInTheDocument();
    });

    it('offers removal to an active regular member', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<MembersSection />);

      await screen.findByText('bob@example.com');
      openRowMenu('bob@example.com');

      expect(
        screen.getByRole('menuitem', { name: 'Remove from organization' }),
      ).toBeInTheDocument();
    });

    it('never offers to remove or delete the owner', async () => {
      // Both are refused by guards on the server. A button that always errors
      // is worse than no button.
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<MembersSection />);

      await screen.findByText('alice@example.com');
      openRowMenu('alice@example.com');

      expect(
        screen.queryByRole('menuitem', { name: 'Remove from organization' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Delete account' })).not.toBeInTheDocument();
    });

    it('opens the restore dialog for a removed member', async () => {
      listUsersFn.mockResolvedValue({ items: everyone, nextCursor: null });
      renderWithClient(<MembersSection />);

      await screen.findByText('dave@example.com');
      openRowMenu('dave@example.com');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Restore to organization' }));

      expect(
        await screen.findByRole('heading', { name: /restore this person to the organization/i }),
      ).toBeInTheDocument();
    });
  });
});
