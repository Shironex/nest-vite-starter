import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsStrings } from '@/features/settings/Settings.strings';
import { useDataExportSection } from './DataExportSection.hooks';

// The component test renders the shell; this suite drives the REAL hook so the
// fetch, file-save and error branches are exercised and covered.
vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { queryFn } = vi.hoisted(() => ({ queryFn: vi.fn() }));

// Only `trpc` is imported by the hook; the proxy stands in with a plain
// queryKey + queryFn pair, which is all `fetchQuery` needs.
vi.mock('@/lib/trpc', () => ({
  trpc: {
    dataExport: {
      download: {
        queryOptions: () => ({ queryKey: [['dataExport', 'download']], queryFn }),
      },
    },
  },
}));

const exportFixture = {
  exportSchema: 1 as const,
  exportedAt: new Date('2026-01-15T10:00:00Z'),
  account: {
    id: 'u-1',
    email: 'user@example.com',
    displayName: null,
    avatarUrl: null,
    role: 'USER',
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
};

// One client per test, created OUTSIDE the wrapper component: the wrapper
// re-renders with the hook, and a client minted inside it would be replaced
// mid-mutation.
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useDataExportSection', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('downloads the export as a date-stamped json file', async () => {
    queryFn.mockResolvedValue(exportFixture);
    const { result } = renderHook(() => useDataExportSection(), { wrapper: createWrapper() });

    // Spy AFTER renderHook so the container element is created normally; only
    // intercept the <a> the hook makes for the download.
    const click = vi.fn();
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement;
    const original = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => (tag === 'a' ? anchor : original(tag)));

    act(() => result.current.onDownload());

    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(anchor.download).toBe('saas-starter-account-export-2026-01-15.json');
    expect(queryFn).toHaveBeenCalledOnce();
    expect(result.current.errorMessage).toBeUndefined();
    createElement.mockRestore();
  });

  it('surfaces the panel copy rather than the raw message when the export fails', async () => {
    queryFn.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDataExportSection(), { wrapper: createWrapper() });

    act(() => result.current.onDownload());

    // Not a tRPC error response, so translateAppError returns undefined and
    // the panel's own catalog copy renders instead of the raw message.
    await waitFor(() => expect(result.current.errorMessage).toBe(settingsStrings.dataExport.error));
    expect(result.current.errorMessage).not.toBe('boom');
    expect(result.current.isPending).toBe(false);
  });
});
