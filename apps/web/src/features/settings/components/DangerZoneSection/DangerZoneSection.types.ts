import type { DeleteAccountInput } from '@repo/shared/schemas';
import type { UseFormReturn } from 'react-hook-form';

export interface IDangerZoneSectionView {
  readonly form: UseFormReturn<DeleteAccountInput>;
  readonly onSubmit: (data: DeleteAccountInput) => void;
  readonly isPending: boolean;
  readonly isDialogOpen: boolean;
  readonly onDialogOpenChange: (open: boolean) => void;
}
