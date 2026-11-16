import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@repo/ui/sonner';
import { twoFactorRegenerateSchema, type TwoFactorRegenerateInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import { getAppErrorCode } from '@/lib/trpc-errors';
import type { IRegenerateDialogProps, IRegenerateDialogView } from './RegenerateDialog.types';

export function useRegenerateDialog({
  onOpenChange,
}: IRegenerateDialogProps): IRegenerateDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [codes, setCodes] = useState<readonly string[] | null>(null);

  const form = useForm<TwoFactorRegenerateInput>({
    resolver: zodResolver(twoFactorRegenerateSchema),
    mode: 'onBlur',
    defaultValues: { password: '' },
  });

  const regenerateMutation = useMutation({
    ...trpc.twoFactor.regenerateRecoveryCodes.mutationOptions(),
    onSuccess: (data) => {
      setCodes(data.recoveryCodes);
      // The remaining-codes count on the security card changed.
      void queryClient.invalidateQueries(trpc.twoFactor.status.queryOptions());
    },
    onError: (error) => {
      if (getAppErrorCode(error) === AppErrorCode.INVALID_CREDENTIALS) {
        form.setError('password', { message: t('twoFactor.regenerate.passwordIncorrect') });
      } else {
        toast.error(translateAppError(error) ?? t('twoFactor.regenerate.failed'));
      }
    },
  });

  function onSubmit(data: TwoFactorRegenerateInput) {
    regenerateMutation.mutate(data);
  }

  function onDone() {
    setCodes(null);
    form.reset();
    onOpenChange(false);
  }

  return { form, onSubmit, isPending: regenerateMutation.isPending, codes, onDone };
}
