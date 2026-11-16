import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useMembersSection } from './MembersSection.hooks';

const { listUsersFn, authState } = vi.hoisted(() => ({
  listUsersFn: vi.fn(),
  authState: { user: { id: 'u-self' } as { id: string } | null },
}));

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => authState }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    user: {
      listUsers: {
        queryOptions: (input?: { cursor?: string; limit?: number }) => ({
          queryKey: ['user', 'listUsers', input],
          queryFn: () => listUsersFn(input),
        }),
      },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const memberA = {
  id: 'u-1',
  email: 'a@example.com',
  displayName: 'Alice',
  role: 'ADMIN',
  emailVerified: true,
  lockedUntil: null,
  createdAt: new Date(),
  twoFactorEnabled: true,
  membershipEndedAt: null,
  isOwner: false,
  status: 'active' as const,
};
const memberB = {
  id: 'u-2',
  email: 'b@example.com',
  displayName: null,
  role: 'USER',
  emailVerified: false,
  lockedUntil: null,
  createdAt: new Date(),
  twoFactorEnabled: false,
  membershipEndedAt: null,
  isOwner: false,
  status: 'active' as const,
};

afterEach(() => vi.clearAllMocks());

describe('useMembersSection', () => {
  it('holds one page and states the position against the total', async () => {
    listUsersFn.mockResolvedValue({ items: [memberA], nextCursor: 'u-1', total: 2 });
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    await waitFor(() => expect(result.current.members).toHaveLength(1));
    expect(result.current.members[0]?.email).toBe('a@example.com');
    expect(result.current.pagination).toMatchObject({
      summary: 'Showing 1-1 of 2',
      hasNext: true,
      hasPrevious: false,
    });
  });

  it('REPLACES the page rather than accumulating it, and can walk back', async () => {
    listUsersFn.mockResolvedValueOnce({ items: [memberA], nextCursor: 'u-1', total: 2 });
    const { result } = renderHook(() => useMembersSection(), { wrapper });
    await waitFor(() => expect(result.current.members).toHaveLength(1));

    listUsersFn.mockResolvedValueOnce({ items: [memberB], nextCursor: null, total: 2 });
    act(() => result.current.pagination?.onNext());

    await waitFor(() => expect(result.current.members.map((m) => m.id)).toEqual(['u-2']));
    expect(result.current.pagination).toMatchObject({
      summary: 'Showing 51-51 of 2',
      hasNext: false,
      hasPrevious: true,
    });

    // Back is a pop off the visited-cursor stack; a keyset API cannot be asked
    // for the previous page any other way.
    listUsersFn.mockResolvedValueOnce({ items: [memberA], nextCursor: 'u-1', total: 2 });
    act(() => result.current.pagination?.onPrevious());
    await waitFor(() => expect(result.current.members.map((m) => m.id)).toEqual(['u-1']));
  });

  it('replaces the table while the first page is loading, and when it is empty', async () => {
    listUsersFn.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('empty'));
    // No footer over an empty card: there is no position to state.
    expect(result.current.pagination).toBeNull();
  });

  it('tracks the dialog opened for a member and clears it on close', async () => {
    listUsersFn.mockResolvedValue({ items: [], nextCursor: null, total: 2 });
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    act(() => result.current.onOpenDialog('resetTwoFactor', memberA));
    expect(result.current.dialogTarget?.kind).toBe('resetTwoFactor');
    expect(result.current.dialogTarget?.member.id).toBe('u-1');

    act(() => result.current.onCloseDialog());
    expect(result.current.dialogTarget).toBeNull();
  });

  it('replaces the open dialog when another action is chosen', async () => {
    listUsersFn.mockResolvedValue({ items: [], nextCursor: null, total: 2 });
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    act(() => result.current.onOpenDialog('changeRole', memberA));
    act(() => result.current.onOpenDialog('delete', memberB));

    expect(result.current.dialogTarget?.kind).toBe('delete');
    expect(result.current.dialogTarget?.member.id).toBe('u-2');
  });

  it('opens and closes the withdraw-by-address dialog, which has no member', async () => {
    listUsersFn.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    expect(result.current.isWithdrawByEmailOpen).toBe(false);
    act(() => result.current.onOpenWithdrawByEmail());
    expect(result.current.isWithdrawByEmailOpen).toBe(true);
    expect(result.current.dialogTarget).toBeNull();

    act(() => result.current.onCloseWithdrawByEmail());
    expect(result.current.isWithdrawByEmailOpen).toBe(false);
  });
});

/**
 * A failed listUsers is a failed read, not an empty organization.
 *
 * Without the isError branch the panel rendered "No members found." plus
 * an Invite button while the api was 500ing, i.e. it stated that the organization has
 * no members. Nothing corrected it: the query cache toasts a BACKGROUND
 * refetch failure only, never an initial load.
 */
describe('useMembersSection current user', () => {
  afterEach(() => {
    authState.user = { id: 'u-self' };
  });

  it("exposes the signed-in admin's id, so their own row can hide actions aimed at them", () => {
    listUsersFn.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    expect(result.current.currentUserId).toBe('u-self');
  });

  it('reads null while the profile is still loading', () => {
    authState.user = null;
    listUsersFn.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    expect(result.current.currentUserId).toBeNull();
  });
});

describe('useMembersSection failure', () => {
  it('reports a failed load as an error, not as an empty list', async () => {
    listUsersFn.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.state).not.toBe('empty');
    expect(result.current.members).toEqual([]);
  });

  it('offers a retry that refetches', async () => {
    listUsersFn.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useMembersSection(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('error'));

    listUsersFn.mockResolvedValue({ items: [memberA, memberB], nextCursor: null, total: 2 });
    act(() => result.current.onRetry());

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.members).toHaveLength(2);
  });

  it('hides the pager while the load is failing, so it cannot page a broken list', async () => {
    listUsersFn.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMembersSection(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.pagination).toBeNull();
  });
});
