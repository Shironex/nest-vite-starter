import type { UseFormReturn } from 'react-hook-form';
import type { TwoFactorDisableInput } from '@repo/shared/schemas';

export interface IDisableDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export interface IDisableDialogView {
  readonly form: UseFormReturn<TwoFactorDisableInput>;
  readonly onSubmit: (data: TwoFactorDisableInput) => void;
  readonly isPending: boolean;
}
