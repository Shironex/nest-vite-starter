import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorCode } from '@repo/shared/errors';
import { useConnectedAccountsSection } from './ConnectedAccountsSection.hooks';

const {
  listFn,
  unlinkFn,
  invalidateQueries,
  toastSuccess,
  toastError,
  electron,
  routerSearch,
  navigate,
} = vi.hoisted(() => ({
  listFn: vi.fn(),
  unlinkFn: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  electron: { isElectron: false },
  routerSearch: { current: {} as Record<string, unknown> },
  navigate: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => routerSearch.current,
  useNavigate: () => navigate,
}));
vi.mock('@/lib/electron', () => ({
  get IS_ELECTRON() {
    return electron.isElectron;
  },
  getApiBaseUrl: () => '',
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    oauth: {
      listAccounts: {
        queryOptions: () => ({ queryKey: ['oauth', 'listAccounts'], queryFn: listFn }),
        pathFilter: () => ({ queryKey: ['oauth', 'listAccounts'] }),
      },
      unlink: { mutationOptions: () => ({ mutationFn: unlinkFn }) },
    },
  },
}));

const assign = vi.fn();
const fetchMock = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Two linked Google accounts: legal, and distinguishable only by row id. */
const TWO_GOOGLE_ACCOUNTS = {
  accounts: [
    {
      id: 'acc-1',
      provider: 'google',
      email: 'first@gmail.com',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      lastUsedAt: new Date('2026-08-01T10:00:00Z'),
    },
    {
      id: 'acc-2',
      provider: 'google',
      email: 'second@gmail.com',
      createdAt: new Date('2026-07-15T10:00:00Z'),
      lastUsedAt: new Date('2026-07-20T10:00:00Z'),
    },
  ],
};

beforeEach(() => {
  electron.isElectron = false;
  routerSearch.current = {};
  listFn.mockResolvedValue({ accounts: [] });
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ providers: [{ key: 'google' }] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { assign, href: 'http://localhost/settings' },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('useConnectedAccountsSection', () => {
  it('renders two rows for two linked Google accounts, keyed by row id', async () => {
    listFn.mockResolvedValue(TWO_GOOGLE_ACCOUNTS);
    const { result } = renderHook(() => useConnectedAccountsSection(), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map((row) => row.id)).toEqual(['acc-1', 'acc-2']);
    expect(result.current.rows[0]?.providerName).toBe('Google');
    expect(result.current.rows[0]?.email).toBe('first@gmail.com');
    expect(result.current.rows[1]?.email).toBe('second@gmail.com');
    expect(result.current.rows[0]?.linkedOn).toBe('Linked 07/01/2026');
    // Both rows are Google, so Google is linked and no link button remains.
    expect(result.current.linkOptions).toEqual([]);
  });

  it('offers a link action for an enabled provider with no linked row', async () => {
    const { result } = renderHook(() => useConnectedAccountsSection(), { wrapper });

    await waitFor(() => expect(result.current.linkOptions).toHaveLength(1));
    expect(result.current.linkOptions[0]).toEqual({
      key: 'google',
      label: 'Link Google account',
    });
    expect(result.current.rows).toEqual([]);
    expect(result.current.state).not.toBe('loading');
  });

  it('never discovers providers in the Electron shell, so no link buttons', async () => {
    listFn.mockResolvedValue(TWO_GOOGLE_ACCOUNTS);
    electron.isElectron = true;
    const { result } = renderHook(() => useConnectedAccountsSection(), { wrapper });

    // The list and unlink still work there (plain tRPC); only link needs the
    // browser flow that v1 does not have.
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.linkOptions).toEqual([]);
  });

  it('runs the sudo dialog BEFORE the link navigation, then leaves the page', async () => {
    const { result } = renderHook(() => useConnectedAccountsSection(), { wrapper });
    await waitFor(() => expect(result.current.linkOptions).toHaveLength(1));

    act(() => result.current.onLink('google'));
    expect(result.current.isDialogOpen).toBe(true);
    expect(assign).not.toHaveBeenCalled();

    act(() => result.current.onSudoConfirmed());

    // A grant seconds old is what makes /start's sudo check pass; its failure
    // mode is a full-page /auth?error redirect, which must never be routine.
    expect(assign).toHaveBeenCalledWith('/api/auth/oauth/google/start?intent=link');
  });

  it('unlinks the addressed row and refreshes the list', async () => {
    listFn.mockResolvedValue(TWO_GOOGLE_ACCOUNTS);
    unlinkFn.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useConnectedAccountsSection(), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.onUnlink('acc-2'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Account unlinked.'));
    // The SECOND Google row: unlink addresses the row id, never the provider.
    expect(unlinkFn.mock.calls[0]?.[0]).toEqual({ accountId: 'acc-2' });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['oauth', 'listAccounts'] });
    expect(result.current.isDialogOpen).toBe(false);
  });

  it('treats FORBIDDEN as the normal re-prompt flow and retries the same row', async () => {
    listFn.mockResolvedValue(TWO_GOOGLE_ACCOUNTS);
    // The 300 s sudo window expired while the page sat open: the first
    // attempt answers FORBIDDEN, the retry after re-confirming succeeds.
    unlinkFn
      .mockRejectedValueOnce({ data: { appCode: AppErrorCode.FORBIDDEN }, message: 'FORBIDDEN' })
      .mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useConnectedAccountsSection(), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.onUnlink('acc-2'));

    await waitFor(() => expect(result.current.isDialogOpen).toBe(true));
    // A normal flow, not an error state: no failure toast for FORBIDDEN.
    expect(toastError).not.toHaveBeenCalled();

    act(() => result.current.onSudoConfirmed());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Account unlinked.'));
    expect(unlinkFn).toHaveBeenCalledTimes(2);
    expect(unlinkFn.mock.calls[1]?.[0]).toEqual({ accountId: 'acc-2' });
  });

  it('surfaces the last-credential refusal with the catalog sentence', async () => {
    listFn.mockResolvedValue(TWO_GOOGLE_ACCOUNTS);
    unlinkFn.mockRejectedValue({
      data: { appCode: AppErrorCode.PASSWORD_NOT_SET },
      message: 'PASSWORD_NOT_SET',
    });
    const { result } = renderHook(() => useConnectedAccountsSection(), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.onUnlink('acc-1'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'This account does not have a password set. Set one via password reset to continue.',
      ),
    );
    expect(result.current.isDialogOpen).toBe(false);
  });

  it('announces ?oauth_linked= once and strips it from the URL', async () => {
    routerSearch.current = { oauth_linked: 'google' };
    renderHook(() => useConnectedAccountsSection(), { wrapper });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Google account linked.'));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    // replace, so Back does not resurrect the param and re-announce.
    expect(navigate).toHaveBeenCalledWith({ to: '/settings', search: {}, replace: true });
  });

  it('ignores an unknown oauth_linked value instead of announcing it', async () => {
    routerSearch.current = { oauth_linked: 'github' };
    const { result } = renderHook(() => useConnectedAccountsSection(), { wrapper });

    await waitFor(() => expect(result.current.state).not.toBe('loading'));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
