import type { UseFormReturn } from 'react-hook-form';
import type { StaffInviteWithdrawByEmailInput } from '@repo/shared/schemas';

export interface IWithdrawInviteByEmailDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export interface IWithdrawInviteByEmailDialogView {
  readonly form: UseFormReturn<StaffInviteWithdrawByEmailInput>;
  readonly onSubmit: (data: StaffInviteWithdrawByEmailInput) => void;
  readonly isPending: boolean;
}
