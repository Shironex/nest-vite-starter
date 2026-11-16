import type { UseFormReturn } from 'react-hook-form';
import type { ConfirmPasswordInput } from '@repo/shared/schemas';

export interface IConfirmPasswordDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Called after `auth.confirmPassword` succeeds, meaning the api has granted
   * this SESSION its 300 s sudo window. Invoked BEFORE the dialog closes so
   * the caller still holds whatever pending action prompted the dialog.
   */
  readonly onConfirmed: () => void;
}

export interface IConfirmPasswordDialogView {
  readonly form: UseFormReturn<ConfirmPasswordInput>;
  readonly onSubmit: (data: ConfirmPasswordInput) => void;
  readonly isPending: boolean;
  /**
   * True once the api answered PASSWORD_NOT_SET: an OAuth-only account has no
   * password to re-enter, so the form is replaced by the set-a-password-first
   * explanation and its route to password reset.
   */
  readonly hasNoPassword: boolean;
}
