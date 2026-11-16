import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { buildAuditLogRow, useAuditLogSection } from './AuditLogSection.hooks';

const { listFn } = vi.hoisted(() => ({ listFn: vi.fn() }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: {
      list: {
        queryOptions: (input?: { cursor?: string; limit?: number }) => ({
          queryKey: ['audit', 'list', input],
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

const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  action: 'user.role.changed',
  actor: { id: 'u-1', email: 'alice@example.com', displayName: 'Alice' },
  targetType: 'User',
  targetId: 'u-2',
  success: true,
  createdAt: new Date('2026-01-02T10:30:00Z'),
  ...overrides,
});

afterEach(() => vi.clearAllMocks());

describe('buildAuditLogRow', () => {
  it('names the actor, labels the event and the target', () => {
    const row = buildAuditLogRow(item('a-1'));

    expect(row.actorName).toBe('Alice');
    expect(row.actionLabel).toBe('Role changed');
    expect(row.actionTone).toBe('neutral');
    expect(row.targetLabel).toBe('User (u-2)');
  });

  it('falls back to the email, then to the system actor', () => {
    expect(
      buildAuditLogRow(
        item('a-1', { actor: { id: 'u-1', email: 'alice@example.com', displayName: null } }),
      ).actorName,
    ).toBe('alice@example.com');
    expect(buildAuditLogRow(item('a-1', { actor: null })).actorName).toBe('System');
  });

  it('leaves the target empty for an event that has none', () => {
    expect(buildAuditLogRow(item('a-1', { targetType: null, targetId: null })).targetLabel).toBe(
      null,
    );
  });
});

describe('useAuditLogSection', () => {
  it('asks for the first page with no filters and states the position', async () => {
    listFn.mockResolvedValue({ items: [item('a-1'), item('a-2')], nextCursor: 'a-2' });
    const { result } = renderHook(() => useAuditLogSection(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(listFn).toHaveBeenCalledWith({ limit: 25 });
    expect(result.current.pagination?.summary).toBe('Showing 1-2');
    expect(result.current.pagination?.hasNext).toBe(true);
    expect(result.current.pagination?.hasPrevious).toBe(false);
  });

  it('pages forward by the cursor the server handed back', async () => {
    listFn.mockResolvedValueOnce({ items: [item('a-1')], nextCursor: 'a-1' });
    listFn.mockResolvedValueOnce({ items: [item('a-2')], nextCursor: null });
    const { result } = renderHook(() => useAuditLogSection(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => result.current.pagination?.onNext());

    await waitFor(() => expect(listFn).toHaveBeenLastCalledWith({ limit: 25, cursor: 'a-1' }));
    await waitFor(() => expect(result.current.pagination?.hasNext).toBe(false));
    expect(result.current.pagination?.hasPrevious).toBe(true);
    expect(result.current.pagination?.summary).toBe('Showing 26-26');
  });

  it('reports an empty trail as empty, with no pager', async () => {
    listFn.mockResolvedValue({ items: [], nextCursor: null });
    const { result } = renderHook(() => useAuditLogSection(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('empty'));
    expect(result.current.pagination).toBeNull();
  });

  it('reports a failed read as an error rather than an empty trail', async () => {
    listFn.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useAuditLogSection(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('error'));
  });
});
