import type { UseFormReturn } from 'react-hook-form';
import type { RequestEmailChangeInput } from '@repo/shared/schemas';

export interface IEmailChangeSectionView {
  /** The address the account signs in with today, from the session profile. */
  readonly currentEmail: string;
  readonly form: UseFormReturn<RequestEmailChangeInput>;
  readonly onSubmit: (data: RequestEmailChangeInput) => void;
  readonly isPending: boolean;
  /** True when 2FA is active, so the form must also collect a current code. */
  readonly requiresFactorCode: boolean;
  /** The address awaiting confirmation after a successful request, else null. */
  readonly pendingSentTo: string | null;
  readonly isDialogOpen: boolean;
  readonly onDialogOpenChange: (open: boolean) => void;
  readonly onSudoConfirmed: () => void;
}
