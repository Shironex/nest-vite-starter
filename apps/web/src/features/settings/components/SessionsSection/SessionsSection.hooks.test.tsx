import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useSessionsSection } from './SessionsSection.hooks';

const { listFn, revokeFn, revokeOthersFn, invalidateQueries, toastSuccess, toastError } =
  vi.hoisted(() => ({
    listFn: vi.fn(),
    revokeFn: vi.fn(),
    revokeOthersFn: vi.fn(),
    invalidateQueries: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@/lib/trpc', () => ({
  trpc: {
    sessions: {
      list: {
        queryOptions: () => ({ queryKey: ['sessions', 'list'], queryFn: listFn }),
        pathFilter: () => ({ queryKey: ['sessions', 'list'] }),
      },
      revoke: { mutationOptions: () => ({ mutationFn: revokeFn }) },
      revokeOthers: { mutationOptions: () => ({ mutationFn: revokeOthersFn }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CHROME_WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) saas-starter/1.0.0 Chrome/126.0.0.0 Electron/31.0.0 Safari/537.36';

const sessionItem = (id: string, overrides: Partial<Record<string, unknown>> = {}) => ({
  id,
  ip: '203.0.113.7',
  userAgent: CHROME_WINDOWS_UA,
  createdAt: new Date('2026-08-01T10:00:00Z').getTime(),
  lastActive: new Date('2026-08-04T10:00:00Z').getTime(),
  isCurrent: false,
  ...overrides,
});

beforeEach(() => {
  listFn.mockResolvedValue([]);
  revokeFn.mockResolvedValue({ success: true });
  revokeOthersFn.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSessionsSection', () => {
  it('maps sessions into display rows: device label, dates, current flag', async () => {
    listFn.mockResolvedValue([
      sessionItem('s-current', { isCurrent: true }),
      sessionItem('s-other', { userAgent: IPHONE_SAFARI_UA }),
    ]);
    const { result } = renderHook(() => useSessionsSection(), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    const [current, other] = result.current.rows;
    expect(current).toMatchObject({
      id: 's-current',
      deviceLabel: 'Chrome · Windows',
      ip: '203.0.113.7',
      isCurrent: true,
      isMobile: false,
    });
    expect(current!.signedIn).toContain('08/01/2026');
    expect(current!.lastActive).toContain('08/04/2026');
    expect(other).toMatchObject({
      deviceLabel: 'Safari · iOS',
      isCurrent: false,
      isMobile: true,
    });
    expect(result.current.hasOtherSessions).toBe(true);
  });

  it('names Edge over Chrome, the desktop shell over its embedded Chrome, and unknowns safely', async () => {
    listFn.mockResolvedValue([
      sessionItem('s-edge', { userAgent: EDGE_UA }),
      sessionItem('s-desktop', { userAgent: ELECTRON_UA }),
      sessionItem('s-weird', { userAgent: 'totally-custom-client/9.1' }),
    ]);
    const { result } = renderHook(() => useSessionsSection(), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(3));

    expect(result.current.rows.map((row) => row.deviceLabel)).toEqual([
      'Edge · Windows',
      'SaaS Starter desktop app',
      'Unknown device',
    ]);
  });

  it('reports no other sessions when this device is the only one', async () => {
    listFn.mockResolvedValue([sessionItem('s-current', { isCurrent: true })]);
    const { result } = renderHook(() => useSessionsSection(), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    expect(result.current.hasOtherSessions).toBe(false);
  });

  it('revokes by opaque id, toasts, and refetches the list', async () => {
    listFn.mockResolvedValue([sessionItem('s-other')]);
    const { result } = renderHook(() => useSessionsSection(), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => result.current.onRevoke('s-other'));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('The session has been signed out'),
    );
    expect(revokeFn.mock.calls[0]?.[0]).toEqual({ sessionId: 's-other' });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sessions', 'list'] });
  });

  it('refetches the list even when a revoke fails: stale rows are the likely cause', async () => {
    revokeFn.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSessionsSection(), { wrapper });

    act(() => result.current.onRevoke('s-gone'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sessions', 'list'] });
  });

  it('signs out others: toasts, closes the dialog, and refetches', async () => {
    const { result } = renderHook(() => useSessionsSection(), { wrapper });

    act(() => result.current.onConfirmOpenChange(true));
    expect(result.current.isConfirmOpen).toBe(true);

    act(() => result.current.onRevokeOthers());

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Other sessions have been signed out'),
    );
    expect(result.current.isConfirmOpen).toBe(false);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sessions', 'list'] });
  });

  it('closes the dialog on a failed sign-out-others too, with an error toast', async () => {
    revokeOthersFn.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSessionsSection(), { wrapper });

    act(() => result.current.onConfirmOpenChange(true));
    act(() => result.current.onRevokeOthers());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(result.current.isConfirmOpen).toBe(false);
  });
});
