import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { SocketEvents } from '@repo/shared/events';
import type { NotificationType } from '@repo/shared/schemas';
import type { StatusTone } from '@repo/ui/status-pill';
import { getSocket } from '@/lib/socket';
import { formatRelativeTime } from '@/lib/time';
import '../../Dashboard.i18n';
import { DASHBOARD_ACTIVITY_ROWS } from '../../Dashboard.constants';
import { useRecentNotifications } from '../../Dashboard.queries';
import type { IActivityFeedRow, IActivityFeedView } from './ActivityFeed.types';

const TONE: Record<NotificationType, StatusTone> = {
  info: 'neutral',
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

/**
 * The activity feed, fixed.
 *
 * WHAT WAS BROKEN. This hook used to read `useSocketStore(s => s.activities)`
 * and nothing else, so the card was empty on every page load and only filled if
 * an event happened to arrive while somebody was looking at it. It was the
 * widest card on the landing page and it rendered its empty state against a
 * database full of records. Worse: nothing in `apps/api`
 * ever emits `SocketEvents.ACTIVITY`, so the store it read is not merely
 * empty-on-load, it is never written at all. The card could not fill.
 *
 * WHAT IT READS NOW. `notifications.list`, which is Postgres-backed, per-user,
 * and carries server-authored copy, so a row needs no client-side
 * catalog to be readable. The socket half of the design is already built around
 * it: `use-socket` merges live NOTIFICATION events into exactly this query's
 * cache entry, so history comes from the read and new events append themselves
 * with no code here. That is the "fetch, then let the socket append" shape,
 * against the one channel the server actually emits on.
 *
 * WHY NOT THE AUDIT LOG, which is what the playground draws (`128:16`). Two
 * reasons, both hard. `audit.list` carries `AdminMiddleware`, so for a USER the
 * card would 403 and stay exactly as empty as it was. And its action labels
 * live in the `audit` feature's catalog (87 of them), which
 * `no-cross-feature-imports` fences this feature out of; the alternatives were
 * a second copy of 87 keys or a vaguer label than the row deserves. An
 * audit-backed feed belongs in `features/audit`, next to the catalog that names
 * its rows, and can then reach the dashboard through the route seam.
 */
export function useActivityFeed(): IActivityFeedView {
  const { t } = useTranslation('dashboard');
  const notifications = useRecentNotifications();

  const rows: IActivityFeedRow[] = (notifications.data?.items ?? [])
    .slice(0, DASHBOARD_ACTIVITY_ROWS)
    .map((item) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      // Formatted here rather than in the shell: the row markup then holds no
      // call at all, and the relative-time wording is covered by this hook's
      // own test.
      timeLabel: formatRelativeTime(new Date(item.createdAt).getTime()),
      tone: TONE[item.type],
      isUnread: !item.read,
    }));

  const onSendTestNotification = useCallback(() => {
    getSocket().emit(SocketEvents.TEST_NOTIFICATION, (ack: { ok: boolean }) => {
      if (ack.ok) {
        toast.success(t('activity.testNotificationSent'));
      } else {
        toast.error(t('activity.testNotificationFailed'));
      }
    });
  }, [t]);

  return {
    rows,
    isLoading: notifications.isLoading,
    hasError: notifications.isError,
    onRetry: () => void notifications.refetch(),
    // Only once the read has RESOLVED, so a slow first paint shows skeletons
    // rather than the "no activity" copy that was the bug.
    isEmpty: notifications.data !== undefined && rows.length === 0,
    showTestControl: import.meta.env.DEV,
    labels: {
      title: t('activity.title'),
      subtitle: t('activity.subtitle'),
      empty: t('activity.empty'),
      emptyHint: t('activity.emptyHint'),
      loadError: t('activity.loadError'),
      retry: t('actions.retry', { ns: 'common' }),
      testNotification: t('activity.testNotification'),
    },
    onSendTestNotification,
  };
}
