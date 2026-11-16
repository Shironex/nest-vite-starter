import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { confirmPasswordSchema } from '@repo/shared/schemas';
import type { ConfirmPasswordInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { getAppErrorCode, translateAppError } from '@/lib/trpc-errors';
import type {
  IConfirmPasswordDialogProps,
  IConfirmPasswordDialogView,
} from './ConfirmPasswordDialog.types';
import { authStrings } from '@/features/auth/Auth.strings';
import { commonStrings, errorStrings } from '@/lib/strings';

/**
 * The sudo prompt (SPEC section 8): re-prove the password to grant this
 * session a 300 s sudo window in Redis. The grant is a server-side flag, so
 * nothing about it is stored here; the only client-visible outcome is
 * `onConfirmed`.
 */
export function useConfirmPasswordDialog({
  onOpenChange,
  onConfirmed,
}: IConfirmPasswordDialogProps): IConfirmPasswordDialogView {
  const form = useForm<ConfirmPasswordInput>({
    resolver: zodResolver(confirmPasswordSchema),
    mode: 'onBlur',
    defaultValues: { password: '' },
  });

  const confirmMutation = useMutation({
    ...trpc.auth.confirmPassword.mutationOptions(),
    onSuccess: () => {
      form.reset();
      // Confirmed BEFORE closing: closing is what makes the caller drop its
      // pending action, so this ordering is the contract, not a nicety.
      onConfirmed();
      onOpenChange(false);
    },
    onError: (error) => {
      const code = getAppErrorCode(error);
      if (code === AppErrorCode.INVALID_CREDENTIALS) {
        // Field-level copy like DisableDialog: the `errorStrings` sentence for this
        // code mentions the e-mail address, which is wrong under a lone
        // password field.
        form.setError('password', { message: authStrings.sudo.invalidPassword });
      } else if (code === AppErrorCode.RATE_LIMITED) {
        // 5 attempts per 300 s per user; that copy fits verbatim.
        form.setError('password', { message: errorStrings.RATE_LIMITED });
      } else {
        toast.error(translateAppError(error) ?? commonStrings.errors.unexpected);
      }
    },
  });

  function onSubmit(data: ConfirmPasswordInput) {
    confirmMutation.mutate(data);
  }

  return { form, onSubmit, isPending: confirmMutation.isPending };
}
