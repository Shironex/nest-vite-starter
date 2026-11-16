import type { AdminUserListPageOutput } from '@repo/shared/schemas';

/** One row of the admin member list, sourced from the `user.listUsers` output. */
export type Member = AdminUserListPageOutput['items'][number];

/** Which confirmation dialog is open for a member row. */
export type MemberDialogKind =
  'resetTwoFactor' | 'changeRole' | 'unlock' | 'delete' | 'remove' | 'restore';

export interface IMemberDialogTarget {
  readonly kind: MemberDialogKind;
  readonly member: Member;
}

/**
 * The footer's degraded pager: a position, a total, and prev/next.
 *
 * `user.listUsers` counts cheaply enough to state a total but still traverses
 * by keyset, so there is no way to ASK for page 7 and numbered buttons would be
 * controls nothing can honor. Null while the card is not showing rows.
 */
export interface IMembersPaginationView {
  readonly summary: string;
  readonly label: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

export interface IMembersSectionView {
  readonly members: Member[];
  /** Epoch millis captured once per mount, for pure lockedUntil comparisons. */
  readonly now: number;
  /** What the card shows. Anything but `ready` replaces the table. */
  readonly state: 'ready' | 'loading' | 'empty' | 'error';
  /** Refetch the list after a failed load; the error slot's only affordance. */
  readonly onRetry: () => void;
  readonly pagination: IMembersPaginationView | null;
  readonly dialogTarget: IMemberDialogTarget | null;
  readonly onOpenDialog: (kind: MemberDialogKind, member: Member) => void;
  readonly onCloseDialog: () => void;
}
