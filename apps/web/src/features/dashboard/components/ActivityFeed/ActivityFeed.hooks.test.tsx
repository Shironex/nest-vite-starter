import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocketEvents } from '@repo/shared/events';
import type { NotificationListOutput } from '@repo/shared/schemas';
import { useActivityFeed } from './ActivityFeed.hooks';

const { emit, success, error, notifications } = vi.hoisted(() => ({
  emit: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  notifications: {
    data: undefined as NotificationListOutput | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@/lib/socket', () => ({ getSocket: () => ({ emit }) }));
vi.mock('@repo/ui/sonner', () => ({ toast: { success, error } }));
vi.mock('../../Dashboard.queries', () => ({ useRecentNotifications: () => notifications }));

function setNotifications(next: Partial<typeof notifications>) {
  Object.assign(notifications, { data: undefined, isLoading: false, isError: false }, next);
}

afterEach(() => vi.clearAllMocks());

describe('useActivityFeed', () => {
  it('is not empty while the history read is still in flight', () => {
    setNotifications({ isLoading: true });
    const { result } = renderHook(() => useActivityFeed());

    // The defect this pins: the feed had no history read, so it reported empty
    // on every page load and the biggest card on the dashboard was always dead.
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('reports empty only once the read resolves with nothing', () => {
    setNotifications({ data: { items: [], unreadCount: 0 } });
    const { result } = renderHook(() => useActivityFeed());

    expect(result.current.isEmpty).toBe(true);
  });

  it('formats each notification into a display-ready row', () => {
    setNotifications({
      data: {
        items: [
          {
            id: 'n1',
            type: 'success',
            title: 'New workspace: Acme Inc.',
            message: 'The record was created.',
            read: false,
            createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
        ],
        unreadCount: 1,
      },
    });
    const { result } = renderHook(() => useActivityFeed());

    expect(result.current.rows[0]).toEqual({
      id: 'n1',
      title: 'New workspace: Acme Inc.',
      message: 'The record was created.',
      timeLabel: '5m ago',
      tone: 'success',
      isUnread: true,
    });
  });

  it('maps every severity onto a state tone rather than defaulting to neutral', () => {
    setNotifications({
      data: {
        items: (['info', 'success', 'warning', 'error'] as const).map((type, index) => ({
          id: `n${index}`,
          type,
          title: type,
          message: '',
          read: true,
          createdAt: new Date().toISOString(),
        })),
        unreadCount: 0,
      },
    });
    const { result } = renderHook(() => useActivityFeed());

    expect(result.current.rows.map((row) => row.tone)).toEqual([
      'neutral',
      'success',
      'warning',
      'danger',
    ]);
  });

  it('translates its copy rather than returning raw keys', () => {
    setNotifications({});
    const { result } = renderHook(() => useActivityFeed());

    expect(result.current.labels.title).toBe('Activity feed');
    expect(result.current.labels.empty).toBe('No recent activity');
  });

  it('confirms a test notification the server acknowledged', () => {
    setNotifications({});
    emit.mockImplementation((_event: string, ack: (r: { ok: boolean }) => void) => {
      ack({ ok: true });
    });
    const { result } = renderHook(() => useActivityFeed());

    result.current.onSendTestNotification();

    expect(emit).toHaveBeenCalledWith(SocketEvents.TEST_NOTIFICATION, expect.any(Function));
    expect(success).toHaveBeenCalledWith('Test notification sent');
    expect(error).not.toHaveBeenCalled();
  });

  it('surfaces a refused test notification instead of claiming success', () => {
    setNotifications({});
    emit.mockImplementation((_event: string, ack: (r: { ok: boolean }) => void) => {
      ack({ ok: false });
    });
    const { result } = renderHook(() => useActivityFeed());

    result.current.onSendTestNotification();

    expect(error).toHaveBeenCalledWith('Failed to send the test notification');
    expect(success).not.toHaveBeenCalled();
  });
});
