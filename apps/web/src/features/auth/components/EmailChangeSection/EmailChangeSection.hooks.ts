import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { requestEmailChangeSchema } from '@repo/shared/schemas';
import type { RequestEmailChangeInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { getAppErrorCode, translateAppError } from '@/lib/trpc-errors';
import { useAuth } from '@/hooks/use-auth';
import type { IEmailChangeSectionView } from './EmailChangeSection.types';

/**
 * The email-change form state. Sudo gates the request: the mutation attempts
 * FIRST and treats
 * FORBIDDEN as "open the password dialog and retry": the 300 s sudo window
 * routinely expires while settings sit open, so FORBIDDEN is the normal flow
 * here, not an error state, and attempting first spares a user with a live
 * grant a second prompt.
 *
 * The 2FA code field shows whenever `twoFactor.status` reports an active
 * factor; the query is issued directly here rather than through the
 * two-factor feature's hook because `no-cross-feature-imports` fences that
 * feature off (`trpc` in lib is shared surface).
 */
export function useEmailChangeSection(): IEmailChangeSectionView {
  const { t } = useTranslation();
  const { user } = useAuth();

  const twoFactorQuery = useQuery({ ...trpc.twoFactor.status.queryOptions() });

  const form = useForm<RequestEmailChangeInput>({
    resolver: zodResolver(requestEmailChangeSchema),
    mode: 'onBlur',
    defaultValues: {
      newEmail: '',
      factorCode: '',
    },
  });

  const [pendingSentTo, setPendingSentTo] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<RequestEmailChangeInput | null>(null);

  const requestMutation = useMutation({
    ...trpc.auth.requestEmailChange.mutationOptions(),
    onSuccess: (_data, variables) => {
      toast.success(t('auth.emailChange.requestedToast'));
      setPendingSentTo(variables.newEmail);
      form.reset();
    },
    onError: (error, variables) => {
      const code = getAppErrorCode(error);
      if (code === AppErrorCode.FORBIDDEN) {
        // No live sudo grant. Remember the submission from the mutation's own
        // variables (not form state, which a re-render could have dropped)
        // and re-prompt; onSudoConfirmed retries it.
        setPendingRetry(variables);
        setIsDialogOpen(true);
      } else if (code === AppErrorCode.EMAIL_IN_USE || code === AppErrorCode.DISPOSABLE_EMAIL) {
        form.setError('newEmail', {
          message: translateAppError(error) ?? t('errors.unexpected'),
        });
      } else if (code === AppErrorCode.TWO_FACTOR_INVALID_CODE) {
        form.setError('factorCode', {
          message: translateAppError(error) ?? t('errors.unexpected'),
        });
      } else {
        toast.error(translateAppError(error) ?? t('errors.unexpected'));
      }
    },
  });

  function onSubmit(data: RequestEmailChangeInput) {
    setPendingSentTo(null);
    requestMutation.mutate({
      newEmail: data.newEmail,
      // The optional field travels as absent, not as an empty string.
      ...(data.factorCode ? { factorCode: data.factorCode } : {}),
    });
  }

  function onSudoConfirmed() {
    if (pendingRetry !== null) {
      const variables = pendingRetry;
      setPendingRetry(null);
      requestMutation.mutate(variables);
    }
  }

  function onDialogOpenChange(open: boolean) {
    setIsDialogOpen(open);
    if (!open) {
      // Canceling abandons the pending submission. Runs AFTER a successful
      // confirm too, harmlessly: onConfirmed fires first (the dialog's
      // ordering contract) and has already consumed the pending value.
      setPendingRetry(null);
    }
  }

  return {
    currentEmail: user?.email ?? '',
    form,
    onSubmit,
    isPending: requestMutation.isPending,
    requiresFactorCode: twoFactorQuery.data?.enabled === true,
    pendingSentTo,
    isDialogOpen,
    onDialogOpenChange,
    onSudoConfirmed,
  };
}
