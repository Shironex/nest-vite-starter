import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/use-auth';
import { useCarriedTotal, useCursorPages } from '@/features/shared/CursorPages.hooks';
import type {
  IAdminUserDialogTarget,
  IUsersPaginationView,
  IUsersSectionView,
  AdminUserDialogKind,
  AdminUser,
} from './UsersSection.types';
import { adminStrings } from '@/features/admin/Admin.strings';

const PAGE_SIZE = 50;

/**
 * The admin user list.
 *
 * Paging REPLACES rather than appends: a page is a query, and a screen that
 * grows every time you press a button has no position to state. `useCursorPages`
 * keeps the stack of cursors already visited so "Previous" is a pop, which is
 * the one move a bare keyset cursor cannot make on its own.
 */
export function useUsersSection(): IUsersSectionView {
  const [dialogTarget, setDialogTarget] = useState<IAdminUserDialogTarget | null>(null);
  // A bare Date.now() in render scope is impure (react-hooks/purity), so the
  // lock-badge comparison point is captured once per mount. Unlocking
  // invalidates the list, and the refetched lockedUntil clears the badge.
  const [now] = useState(() => Date.now());
  const pages = useCursorPages();
  const { user: currentUser } = useAuth();

  const { data, isPending, isError, refetch } = useQuery(
    trpc.user.listUsers.queryOptions({
      ...(pages.cursor !== undefined ? { cursor: pages.cursor } : {}),
      limit: PAGE_SIZE,
    }),
  );

  const users: AdminUser[] = data?.items ?? [];
  /*
   * `isError` is read BEFORE the empty test on purpose. Without it a failed
   * listUsers renders as "No users found.", i.e. the panel claims the app has no users. There is no toast to correct it
   * either: the query cache only toasts a BACKGROUND refetch failure, never an
   * initial load.
   */
  const state = isError ? 'error' : isPending ? 'loading' : users.length === 0 ? 'empty' : 'ready';

  // The FIRST page's count, carried forward: `user.listUsers` counts only when
  // the request has no cursor, because the number is the same for every page of
  // one traversal.
  const total = useCarriedTotal(data?.total);
  const from = (pages.page - 1) * PAGE_SIZE + 1;
  const pagination: IUsersPaginationView | null =
    state !== 'ready' || total === undefined
      ? null
      : {
          summary: adminStrings.users.pagination.summary({
            from,
            to: from + users.length - 1,
            total,
          }),
          label: adminStrings.users.pagination.label,
          hasPrevious: pages.hasPrevious,
          hasNext: (data?.nextCursor ?? null) !== null,
          onPrevious: pages.onPrevious,
          onNext: () => pages.onNext(data?.nextCursor ?? null),
        };

  function onOpenDialog(kind: AdminUserDialogKind, user: AdminUser) {
    setDialogTarget({ kind, user });
  }

  function onCloseDialog() {
    setDialogTarget(null);
  }

  return {
    users,
    currentUserId: currentUser?.id,
    onRetry: () => void refetch(),
    now,
    state,
    pagination,
    dialogTarget,
    onOpenDialog,
    onCloseDialog,
  };
}
