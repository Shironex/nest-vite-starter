import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AUDIT_LOG_LIST_DEFAULT_LIMIT } from '@repo/shared/constants';
import type { AuditLogItem } from '@repo/shared/schemas';
import { APP_LOCALE, formatDate } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import { useCursorPages } from '@/features/shared/CursorPages.hooks';
import { auditActionLabel, auditActionTone, auditTargetLabel } from '../../Admin.constants';
import type {
  IAuditLogPaginationView,
  IAuditLogRowView,
  IAuditLogSectionView,
} from './AuditLogSection.types';
import { adminStrings } from '@/features/admin/Admin.strings';

const PAGE_SIZE = AUDIT_LOG_LIST_DEFAULT_LIMIT;

const timeFormatter = new Intl.DateTimeFormat(APP_LOCALE, { hour: '2-digit', minute: '2-digit' });

/** One wire item, precomputed into everything its row renders. */
export function buildAuditLogRow(item: AuditLogItem): IAuditLogRowView {
  const actor = item.actor;
  const targetLabel =
    item.targetType === null
      ? null
      : `${auditTargetLabel(item.targetType)}${item.targetId === null ? '' : ` (${item.targetId})`}`;

  return {
    id: item.id,
    whenLabel: `${formatDate(item.createdAt)} ${timeFormatter.format(item.createdAt)}`,
    actorName: actor === null ? adminStrings.audit.systemActor : (actor.displayName ?? actor.email),
    actionLabel: auditActionLabel(item.action),
    actionTone: auditActionTone(item.action, item.success),
    targetLabel,
  };
}

/**
 * The admin audit list: the whole trail, newest first, one keyset page at a
 * time. No filters, no search, no export.
 *
 * Paging REPLACES rather than appends, and the previous page stays on screen
 * while the next one loads (`keepPreviousData`), so the pager never unmounts
 * under the pointer that pressed it. There are no page numbers: `audit.list`
 * carries no total by design (see `packages/shared/src/schemas/audit.ts`).
 */
export function useAuditLogSection(): IAuditLogSectionView {
  const pages = useCursorPages();

  const query = useQuery({
    ...trpc.audit.list.queryOptions({
      limit: PAGE_SIZE,
      ...(pages.cursor !== undefined ? { cursor: pages.cursor } : {}),
    }),
    placeholderData: keepPreviousData,
  });

  const rows = (query.data?.items ?? []).map(buildAuditLogRow);
  const state = query.isError
    ? 'error'
    : query.isPending
      ? 'loading'
      : rows.length === 0
        ? 'empty'
        : 'ready';
  const isRefreshing = query.isFetching && query.isPlaceholderData;
  const nextCursor = query.data?.nextCursor ?? null;

  const from = (pages.page - 1) * PAGE_SIZE + 1;
  const pagination: IAuditLogPaginationView | null =
    state !== 'ready'
      ? null
      : {
          summary: adminStrings.audit.pagination.summary({ from, to: from + rows.length - 1 }),
          label: adminStrings.audit.pagination.label,
          hasPrevious: pages.hasPrevious,
          hasNext: nextCursor !== null,
          isBusy: isRefreshing,
          onPrevious: pages.onPrevious,
          onNext: () => pages.onNext(nextCursor),
        };

  return {
    rows,
    state,
    isRefreshing,
    pagination,
    onRetry: () => void query.refetch(),
  };
}
