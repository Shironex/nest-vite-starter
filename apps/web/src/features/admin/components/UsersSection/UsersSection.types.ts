import type { AdminUserListPageOutput } from '@repo/shared/schemas';

/** One row of the admin user list, sourced from the `user.listUsers` output. */
export type AdminUser = AdminUserListPageOutput['items'][number];

/** Which confirmation dialog is open for a user row. */
export type AdminUserDialogKind =
  'resetTwoFactor' | 'changeRole' | 'unlock' | 'delete' | 'disable' | 'enable' | 'revokeSessions';

export interface IAdminUserDialogTarget {
  readonly kind: AdminUserDialogKind;
  readonly user: AdminUser;
}

/**
 * The footer's degraded pager: a position, a total, and prev/next.
 *
 * `user.listUsers` counts cheaply enough to state a total but still traverses
 * by keyset, so there is no way to ASK for page 7 and numbered buttons would be
 * controls nothing can honor. Null while the card is not showing rows.
 */
export interface IUsersPaginationView {
  readonly summary: string;
  readonly label: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

export interface IUsersSectionView {
  readonly users: AdminUser[];
  /**
   * The signed-in admin's id. Their own row offers no role change, sign-out,
   * 2FA reset, disable or delete: the api refuses every one of them for the
   * caller's own account, and a menu item that always errors is worse than
   * none.
   */
  readonly currentUserId: string | undefined;
  /** Epoch millis captured once per mount, for pure lockedUntil comparisons. */
  readonly now: number;
  /** What the card shows. Anything but `ready` replaces the table. */
  readonly state: 'ready' | 'loading' | 'empty' | 'error';
  /** Refetch the list after a failed load; the error slot's only affordance. */
  readonly onRetry: () => void;
  readonly pagination: IUsersPaginationView | null;
  readonly dialogTarget: IAdminUserDialogTarget | null;
  readonly onOpenDialog: (kind: AdminUserDialogKind, user: AdminUser) => void;
  readonly onCloseDialog: () => void;
}
