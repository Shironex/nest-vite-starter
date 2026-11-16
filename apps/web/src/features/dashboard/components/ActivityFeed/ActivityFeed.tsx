import { Activity, Inbox, Zap } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Skeleton } from '@repo/ui/skeleton';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away.
import '../../Dashboard.i18n';
import { useActivityFeed } from './ActivityFeed.hooks';
import type { IActivityFeedRow } from './ActivityFeed.types';
import type { StatusTone } from '@repo/ui/status-pill';

const SKELETON_ROW_KEYS = ['a1', 'a2', 'a3', 'a4'];

/**
 * The marker beside a row carries the event's severity as a tint, the same four
 * tones every state chip in the app uses. It is decoration: the row's own words
 * say what happened, so the dot is never the only carrier of meaning.
 */
const MARKER: Record<StatusTone, string> = {
  neutral: 'bg-subtle text-text-secondary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
};

function ActivityRow({ row }: { row: IActivityFeedRow }) {
  return (
    <li className="flex items-start gap-2.5 py-3 first:pt-0 last:pb-0">
      <span
        aria-hidden="true"
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${MARKER[row.tone]}`}
      >
        <Activity className="size-4" />
      </span>
      {/*
       * Headline and detail on ONE line, time underneath, exactly as the KPI
       * playground draws the feed (`128:16`). Right-aligning the time instead
       * left a 700px gap across the card at 1440px, which read as a layout bug
       * rather than as a column.
       */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate type-body-regular text-text-secondary">
          <span className="type-body-strong text-text">{row.title}</span>
          {row.message !== '' && <span> {row.message}</span>}
        </p>
        <p className="flex items-center gap-1.5 type-label-caption text-text-tertiary">
          {row.timeLabel}
          {/* Unread marker, beside the time rather than pinned to the card's
              right edge, where it floated 800px away from the row it belongs
              to. Decoration only: it repeats nothing the row does not say. */}
          {row.isUnread && (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-brand" />
          )}
        </p>
      </div>
    </li>
  );
}

function SkeletonRow() {
  return (
    <li className="flex items-start gap-2.5 py-3 first:pt-0 last:pb-0">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-72 max-w-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    </li>
  );
}

/**
 * "Activity feed": the system's recent events, from `notifications.list`
 * with live rows merged in by `use-socket`.
 *
 * See the header on `ActivityFeed.hooks.ts` for why this reads notifications
 * rather than the socket store it used to read, and rather than the audit log
 * the playground draws.
 */
export default function ActivityFeed() {
  const v = useActivityFeed();
  const rows = v.rows.map((row) => <ActivityRow key={row.id} row={row} />);
  const skeletonRows = SKELETON_ROW_KEYS.map((key) => <SkeletonRow key={key} />);
  const listItems = v.isLoading ? skeletonRows : rows;
  const showList = !v.hasError && !v.isEmpty;

  const testControl = v.showTestControl ? (
    <Button
      variant="outline"
      size="xs"
      onClick={v.onSendTestNotification}
      className="shrink-0 gap-1"
    >
      <Zap className="size-3" aria-hidden="true" />
      {v.labels.testNotification}
    </Button>
  ) : null;

  const emptyState = (
    <div className="flex flex-col items-center gap-1.5 py-10 text-center">
      <span
        aria-hidden="true"
        className="mb-1 flex size-10 items-center justify-center rounded-full bg-subtle"
      >
        <Inbox className="size-5 text-text-secondary" />
      </span>
      <p className="type-body-strong text-text">{v.labels.empty}</p>
      <p className="max-w-xs type-body-small text-text-muted">{v.labels.emptyHint}</p>
    </div>
  );

  return (
    <Card data-slot="activity-feed" className="gap-0 py-0">
      <div className="flex items-center gap-2 px-4.5 py-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate type-heading-h3 text-text">{v.labels.title}</p>
          <p className="truncate type-label-caption text-text-muted">{v.labels.subtitle}</p>
        </div>
        {testControl}
      </div>

      <div className="h-px bg-border" />

      {/* role="log" + polite live region so socket-driven rows are announced as
          they arrive instead of appearing silently. Kept mounted across the
          empty and loading states so the first row is announced too. */}
      <div role="log" aria-live="polite" className="px-4.5 py-4.5">
        {v.hasError && (
          <div role="alert">
            <p className="type-body-small text-danger">{v.labels.loadError}</p>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={v.onRetry}>
              {v.labels.retry}
            </Button>
          </div>
        )}
        {v.isEmpty && emptyState}
        {showList && <ul className="divide-y divide-border">{listItems}</ul>}
      </div>
    </Card>
  );
}
