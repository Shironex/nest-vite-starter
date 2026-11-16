import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@repo/ui/sonner';
import { twoFactorDisableSchema, type TwoFactorDisableInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import { getAppErrorCode } from '@/lib/trpc-errors';
import type { IDisableDialogProps, IDisableDialogView } from './DisableDialog.types';

export function useDisableDialog({ onOpenChange }: IDisableDialogProps): IDisableDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const form = useForm<TwoFactorDisableInput>({
    resolver: zodResolver(twoFactorDisableSchema),
    mode: 'onBlur',
    defaultValues: { password: '', code: '' },
  });

  const disableMutation = useMutation({
    ...trpc.twoFactor.disable.mutationOptions(),
    onSuccess: () => {
      toast.success(t('twoFactor.disable.success'));
      void queryClient.invalidateQueries(trpc.twoFactor.status.queryOptions());
      form.reset();
      onOpenChange(false);
    },
    onError: (error) => {
      const code = getAppErrorCode(error);
      if (code === AppErrorCode.INVALID_CREDENTIALS) {
        form.setError('password', { message: t('twoFactor.disable.passwordIncorrect') });
      } else if (code === AppErrorCode.TWO_FACTOR_INVALID_CODE) {
        form.setError('code', { message: t('twoFactor.disable.codeIncorrect') });
      } else {
        toast.error(translateAppError(error) ?? t('twoFactor.disable.failed'));
      }
    },
  });

  function onSubmit(data: TwoFactorDisableInput) {
    disableMutation.mutate(data);
  }

  return { form, onSubmit, isPending: disableMutation.isPending };
}
