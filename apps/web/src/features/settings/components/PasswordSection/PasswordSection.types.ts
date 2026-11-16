import type { ChangePasswordInput } from '@repo/shared/schemas';
import type { UseFormReturn } from 'react-hook-form';

export interface IPasswordSectionView {
  readonly form: UseFormReturn<ChangePasswordInput>;
  readonly onSubmit: (data: ChangePasswordInput) => void;
  readonly isPending: boolean;
  readonly newPassword: string;
}
