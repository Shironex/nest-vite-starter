import type { UseFormReturn } from 'react-hook-form';
import type { StaffInviteAcceptInput } from '@repo/shared/schemas';

/**
 * What the screen is doing.
 *
 *   checking: the pre-check is in flight.
 *   ready:    the link is usable and the form is offered.
 *   invalid:  the link is spent, expired or was never real. Nothing to retry.
 *   failed:   we could not ASK. Telling somebody their invitation is dead
 *             because a request timed out is the wrong sentence to put in
 *             front of them, so this state offers a retry instead.
 */
export type StaffInviteState = 'checking' | 'ready' | 'invalid' | 'failed';

export interface IStaffInviteCardView {
  readonly state: StaffInviteState;
  readonly form: UseFormReturn<StaffInviteAcceptInput>;
  readonly onSubmit: (data: StaffInviteAcceptInput) => void;
  readonly onRetry: () => void;
  readonly isPending: boolean;
  readonly password: string;
  /** The account carries an active second factor, so a code is required. */
  readonly requiresTwoFactor: boolean;
  /**
   * Accepting moves an account that already exists, and closes the organization it is
   * in today. Shown ON this screen, above the password field, because a
   * consequence disclosed after the action is not disclosed.
   */
  readonly movesExistingAccount: boolean;
  readonly serverError: string | null;
  /** The link died while the form was open; the form goes away with it. */
  readonly isLinkDead: boolean;
}
