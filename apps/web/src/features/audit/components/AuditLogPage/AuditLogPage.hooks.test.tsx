import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import type { AuditLogItem } from '@repo/shared/schemas';
import { useAuditLogPage } from './AuditLogPage.hooks';

const { listFn } = vi.hoisted(() => ({ listFn: vi.fn() }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: {
      list: {
        queryOptions: (input: unknown) => ({
          queryKey: ['audit.list', input],
          queryFn: () => listFn(input),
        }),
      },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeItem(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    id: 'a-1',
    action: 'user.role.changed',
    actor: { id: 'u-1', email: 'anna@example.com', displayName: 'Anna Keller' },
    targetType: 'User',
    targetId: 'u-2',
    before: null,
    after: null,
    metadata: { fields: ['role'] },
    reason: null,
    ipAddress: '10.0.0.1',
    userAgent: 'vitest',
    correlationId: 'req-1',
    success: true,
    createdAt: new Date('2026-07-14T09:12:00'),
    ...overrides,
  };
}

describe('useAuditLogPage', () => {
  beforeEach(() => {
    listFn.mockReset();
    listFn.mockResolvedValue({ items: [makeItem()], nextCursor: null });
  });

  it('builds display rows off the wire items', async () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    const row = result.current.rows[0];
    expect(row?.actorName).toBe('Anna Keller');
    expect(row?.actorInitials).toBe('AK');
    expect(row?.actionLabel).toBe('Role changed');
    expect(row?.changedFields).toEqual(['role']);
    expect(row?.whenLabel).toContain('07/14/2026');
  });

  it('labels a system row and an unknown action without crashing the feed', async () => {
    listFn.mockResolvedValue({
      items: [makeItem({ id: 'a-2', actor: null, action: 'future.unknown.action' })],
      nextCursor: null,
    });
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    const row = result.current.rows[0];
    expect(row?.actorName).toBe('System');
    expect(row?.isSystem).toBe(true);
    // The fallback keeps the raw action visible instead of a bare key.
    expect(row?.actionLabel).toBe('future.unknown.action');
  });

  it('turns a tab into the action set it stands for, and back again', async () => {
    // A tab is a place: exactly one is current, so the tab and the event-type
    // dropdown can never both look engaged while only one narrows the query.
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onTabChange('failedLogins'));
    await waitFor(() => {
      const lastInput = listFn.mock.calls.at(-1)?.[0] as { actions?: string[] };
      expect(lastInput.actions).toContain('auth.login.failure');
      expect(lastInput.actions).toContain('auth.login.locked');
    });

    act(() => result.current.onTabChange('all'));
    await waitFor(() => {
      const lastInput = listFn.mock.calls.at(-1)?.[0] as { actions?: string[] };
      expect(lastInput.actions).toBeUndefined();
    });
  });

  it('ignores a tab id outside the union', async () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onTabChange('nonsense'));

    expect(result.current.tab).toBe('all');
  });

  it('lets the event-type filter and the tab override each other cleanly', async () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onTabChange('failedLogins'));
    act(() => result.current.filters.onActionChange('user.role.changed'));

    await waitFor(() => {
      const lastInput = listFn.mock.calls.at(-1)?.[0] as { actions?: string[] };
      expect(lastInput.actions).toEqual(['user.role.changed']);
    });
    expect(result.current.tab).toBe('all');
  });

  it('REPLACES a page rather than accumulating it, and can walk back', async () => {
    listFn.mockResolvedValue({ items: [makeItem()], nextCursor: 'a-1' });
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.pagination?.hasNext).toBe(true));

    listFn.mockResolvedValue({
      items: [makeItem({ id: 'a-2', correlationId: 'req-2' })],
      nextCursor: null,
    });
    act(() => result.current.pagination?.onNext());
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(['a-2']));
    const cursorInput = listFn.mock.calls.at(-1)?.[0] as { cursor?: string };
    expect(cursorInput.cursor).toBe('a-1');
    expect(result.current.pagination?.summary).toBe('Showing 26-26');

    // Back is a pop off the visited-cursor stack, not a query the keyset API
    // has any way to express.
    act(() => result.current.pagination?.onPrevious());
    await waitFor(() => {
      const lastInput = listFn.mock.calls.at(-1)?.[0] as { cursor?: string };
      expect(lastInput.cursor).toBeUndefined();
    });
  });

  it('never claims a total, because audit.list deliberately has none', async () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });

    await waitFor(() => expect(result.current.pagination).not.toBeNull());
    expect(result.current.pagination?.summary).toBe('Showing 1-1');
  });

  it('returns to page one when a filter changes the cursor space', async () => {
    listFn.mockResolvedValue({ items: [makeItem()], nextCursor: 'a-1' });
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.pagination?.hasNext).toBe(true));
    act(() => result.current.pagination?.onNext());
    await waitFor(() =>
      expect((listFn.mock.calls.at(-1)?.[0] as { cursor?: string }).cursor).toBe('a-1'),
    );

    // A cursor minted under one filter set does not address the same rows
    // under another, so narrowing resets the pagination wholesale.
    act(() => result.current.filters.onActorChange('u-9'));
    await waitFor(() => {
      const lastInput = listFn.mock.calls.at(-1)?.[0] as { cursor?: string; actorId?: string };
      expect(lastInput.actorId).toBe('u-9');
      expect(lastInput.cursor).toBeUndefined();
    });
  });

  it('turns the calendar-day "to" filter into that day\'s last instant', async () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.filters.onToChange('2026-07-14'));
    await waitFor(() => {
      const lastInput = listFn.mock.calls.at(-1)?.[0] as { to?: Date };
      expect(lastInput.to?.getHours()).toBe(23);
      expect(lastInput.to?.getMinutes()).toBe(59);
    });
  });

  it('clears every filter at once, counting a date RANGE as one', async () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.filters.onActorChange('u-1'));
    act(() => result.current.filters.onFromChange('2026-07-01'));
    act(() => result.current.filters.onToChange('2026-07-14'));
    // "od 1 lipca do 14 lipca" is one period, not two narrowings.
    await waitFor(() => expect(result.current.filters.activeFilters).toBe(2));

    act(() => result.current.filters.onClear());
    await waitFor(() => expect(result.current.filters.activeFilters).toBe(0));
    const lastInput = listFn.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastInput['actorId']).toBeUndefined();
    expect(lastInput['from']).toBeUndefined();
  });

  it('does not count the tab as a filter: it is where you are, not a narrowing', async () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onTabChange('failedLogins'));

    expect(result.current.filters.activeFilters).toBe(0);
  });

  it('distinguishes an empty trail from an over-filtered one', async () => {
    listFn.mockResolvedValue({ items: [], nextCursor: null });
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('empty'));
    expect(result.current.labels.emptyTitle).toBe('The audit log is still empty');
    // No footer over an empty card: there is no position to state.
    expect(result.current.pagination).toBeNull();

    act(() => result.current.onTabChange('failedLogins'));

    await waitFor(() =>
      expect(result.current.labels.emptyTitle).toBe('No events match the selected filters'),
    );
  });
});

/**
 * The two states the trail used to conflate. Five filters, the tab and the
 * cursor are all in the query key, so every date-input keystroke reported
 * `isPending` and swapped the rows for skeleton bars.
 */
describe('useAuditLogPage, first load against a refresh', () => {
  beforeEach(() => {
    listFn.mockReset();
    listFn.mockResolvedValue({ items: [makeItem()], nextCursor: null });
  });

  it('is loading with no pager on the first load', () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });

    expect(result.current.state).toBe('loading');
    expect(result.current.pagination).toBeNull();
    expect(result.current.isRefreshing).toBe(false);
  });

  it('keeps the rows and the pager while a filter change is fetched', async () => {
    const { result } = renderHook(() => useAuditLogPage(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.filters.onActorChange('u-2'));

    expect(result.current.state).toBe('ready');
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.pagination?.isBusy).toBe(true);

    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    expect(result.current.pagination?.isBusy).toBe(false);
  });
});
