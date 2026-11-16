import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { changePasswordSchema } from '@repo/shared/schemas';
import type { ChangePasswordInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import { getAppErrorCode } from '@/lib/trpc-errors';
import type { IPasswordSectionView } from './PasswordSection.types';
import { settingsStrings } from '@/features/settings/Settings.strings';

export function usePasswordSection(): IPasswordSectionView {
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onBlur',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
    },
  });

  const newPassword = form.watch('newPassword');

  const changePasswordMutation = useMutation({
    ...trpc.auth.changePassword.mutationOptions(),
    onSuccess: () => {
      toast.success(settingsStrings.password.success);
      form.reset();
    },
    onError: (error) => {
      // The api throws UnauthorizedError with appCode INVALID_CREDENTIALS when
      // the current password fails verification (password-change.service.ts).
      if (getAppErrorCode(error) === AppErrorCode.INVALID_CREDENTIALS) {
        form.setError('currentPassword', {
          message: settingsStrings.password.currentIncorrect,
        });
      } else {
        toast.error(translateAppError(error) ?? settingsStrings.password.failed);
      }
    },
  });

  function onSubmit(data: ChangePasswordInput) {
    changePasswordMutation.mutate(data);
  }

  return {
    form,
    onSubmit,
    isPending: changePasswordMutation.isPending,
    newPassword,
  };
}
