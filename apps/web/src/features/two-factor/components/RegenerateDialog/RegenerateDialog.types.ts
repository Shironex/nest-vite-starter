import type { UseFormReturn } from 'react-hook-form';
import type { TwoFactorRegenerateInput } from '@repo/shared/schemas';

export interface IRegenerateDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export interface IRegenerateDialogView {
  readonly form: UseFormReturn<TwoFactorRegenerateInput>;
  readonly onSubmit: (data: TwoFactorRegenerateInput) => void;
  readonly isPending: boolean;
  /** The freshly minted codes, revealed once; null while the password step shows. */
  readonly codes: readonly string[] | null;
  readonly onDone: () => void;
}
