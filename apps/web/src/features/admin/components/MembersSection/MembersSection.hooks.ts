import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { useCarriedTotal, useCursorPages } from '@/features/shared/CursorPages.hooks';
import type {
  IMemberDialogTarget,
  IMembersPaginationView,
  IMembersSectionView,
  MemberDialogKind,
  Member,
} from './MembersSection.types';

const PAGE_SIZE = 50;

/**
 * The admin member list.
 *
 * Paging REPLACES rather than appends: a page is a query, and a screen that
 * grows every time you press a button has no position to state. `useCursorPages`
 * keeps the stack of cursors already visited so "Previous" is a pop, which is
 * the one move a bare keyset cursor cannot make on its own.
 */
export function useMembersSection(): IMembersSectionView {
  const { t } = useTranslation();
  const [dialogTarget, setDialogTarget] = useState<IMemberDialogTarget | null>(null);
  // A bare Date.now() in render scope is impure (react-hooks/purity), so the
  // lock-badge comparison point is captured once per mount. Unlocking
  // invalidates the list, and the refetched lockedUntil clears the badge.
  const [now] = useState(() => Date.now());
  const pages = useCursorPages();

  const { data, isPending, isError, refetch } = useQuery(
    trpc.user.listUsers.queryOptions({
      ...(pages.cursor !== undefined ? { cursor: pages.cursor } : {}),
      limit: PAGE_SIZE,
    }),
  );

  const members: Member[] = data?.items ?? [];
  /*
   * `isError` is read BEFORE the empty test on purpose. Without it a failed
   * listUsers renders as "No members found.", i.e. the panel claims the organization has no members. There is no toast to correct it
   * either: the query cache only toasts a BACKGROUND refetch failure, never an
   * initial load.
   */
  const state = isError
    ? 'error'
    : isPending
      ? 'loading'
      : members.length === 0
        ? 'empty'
        : 'ready';

  // The FIRST page's count, carried forward: `user.listUsers` counts only when
  // the request has no cursor, because the number is the same for every page of
  // one traversal.
  const total = useCarriedTotal(data?.total);
  const from = (pages.page - 1) * PAGE_SIZE + 1;
  const pagination: IMembersPaginationView | null =
    state !== 'ready' || total === undefined
      ? null
      : {
          summary: t('admin.members.pagination.summary', {
            from,
            to: from + members.length - 1,
            total,
          }),
          label: t('admin.members.pagination.label'),
          hasPrevious: pages.hasPrevious,
          hasNext: (data?.nextCursor ?? null) !== null,
          onPrevious: pages.onPrevious,
          onNext: () => pages.onNext(data?.nextCursor ?? null),
        };

  function onOpenDialog(kind: MemberDialogKind, member: Member) {
    setDialogTarget({ kind, member });
  }

  function onCloseDialog() {
    setDialogTarget(null);
  }

  return {
    members,
    onRetry: () => void refetch(),
    now,
    state,
    pagination,
    dialogTarget,
    onOpenDialog,
    onCloseDialog,
  };
}
