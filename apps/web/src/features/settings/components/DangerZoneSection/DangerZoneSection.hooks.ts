import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { deleteAccountSchema } from '@repo/shared/schemas';
import type { DeleteAccountInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc, resetCsrfToken } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import { getAppErrorCode } from '@/lib/trpc-errors';
import type { IDangerZoneSectionView } from './DangerZoneSection.types';

export function useDangerZoneSection(): IDangerZoneSectionView {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const form = useForm<DeleteAccountInput>({
    resolver: zodResolver(deleteAccountSchema),
    mode: 'onBlur',
    defaultValues: { password: '' },
  });

  const deleteAccountMutation = useMutation({
    ...trpc.auth.deleteAccount.mutationOptions(),
    onSuccess: () => {
      toast.success(t('settings.dangerZone.success'));
      // Same client teardown as logout (SidebarUserNav): the server already
      // revoked every session and cleared the cookie, so drop the CSRF token
      // and the query cache before landing on the login route.
      resetCsrfToken();
      queryClient.clear();
      void navigate({ to: '/auth/login' });
    },
    onError: (error) => {
      // The api throws UnauthorizedError with appCode INVALID_CREDENTIALS when
      // the confirmation password fails (account-deletion.service.ts), so the
      // error attaches to the password field like PasswordSection does.
      if (getAppErrorCode(error) === AppErrorCode.INVALID_CREDENTIALS) {
        form.setError('password', { message: t('settings.dangerZone.passwordIncorrect') });
      } else {
        toast.error(translateAppError(error) ?? t('settings.dangerZone.failed'));
      }
    },
  });

  function onSubmit(data: DeleteAccountInput) {
    deleteAccountMutation.mutate(data);
  }

  function onDialogOpenChange(open: boolean) {
    // Keep the dialog up while the mutation is in flight so the pending state
    // stays visible; a fresh open always starts from a clean form.
    if (!open && deleteAccountMutation.isPending) {
      return;
    }
    if (!open) {
      form.reset();
    }
    setIsDialogOpen(open);
  }

  return {
    form,
    onSubmit,
    isPending: deleteAccountMutation.isPending,
    isDialogOpen,
    onDialogOpenChange,
  };
}
