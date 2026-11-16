import type { ReactNode } from 'react';

export type ConfirmEmailChangeStatus = 'loading' | 'success' | 'error';

/** Shared centered badge + heading + body, the VerifyEmail state shape. */
export interface IConfirmEmailChangeStateProps {
  /** Background and foreground token classes for the 48px badge. */
  readonly badgeClass: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: ReactNode;
  readonly children?: ReactNode;
}

/** View model for the auto-confirm (token present) branch. */
export interface IConfirmEmailChangeView {
  readonly status: ConfirmEmailChangeStatus;
  readonly errorMessage: string | null;
  /** Re-runs confirmation for the same token after a transient failure. */
  readonly retry: () => void;
}
