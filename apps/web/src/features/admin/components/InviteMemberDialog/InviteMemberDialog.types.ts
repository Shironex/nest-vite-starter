import type { UseFormReturn } from 'react-hook-form';
import type { StaffInviteSendInput } from '@repo/shared/schemas';

export interface IInviteMemberDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export interface IInviteMemberDialogView {
  readonly form: UseFormReturn<StaffInviteSendInput>;
  readonly onSubmit: (data: StaffInviteSendInput) => void;
  readonly isPending: boolean;
  /**
   * Set when the invitation was created but its mail never reached the queue.
   *
   * A separate state rather than a variant of success, because the two need
   * different actions from the admin: a sent invitation is finished, an unsent
   * one has to be sent again, and the invitee cannot ask for it themselves.
   */
  readonly undeliveredEmail: string | null;
}
