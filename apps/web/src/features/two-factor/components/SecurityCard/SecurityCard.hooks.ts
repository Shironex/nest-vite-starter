import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import { useTwoFactorStatus } from '../../TwoFactor.queries';
import type { ISecurityCardView } from './SecurityCard.types';

export function useSecurityCard(): ISecurityCardView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useTwoFactorStatus();
  const [isEnrollOpen, setIsEnrollOpen] = useState(false);
  const [isDisableOpen, setIsDisableOpen] = useState(false);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);

  const revokeMutation = useMutation({
    ...trpc.twoFactor.revokeTrustedDevices.mutationOptions(),
    onSuccess: () => {
      toast.success(t('twoFactor.securityCard.revokedToast'));
      void queryClient.invalidateQueries(trpc.twoFactor.status.queryOptions());
    },
    onError: (error) =>
      toast.error(translateAppError(error) ?? t('twoFactor.securityCard.revokeFailed')),
  });

  function onEnrollComplete() {
    setIsEnrollOpen(false);
    // The wizard already re-issued the session on activate; refetch the card.
    void queryClient.invalidateQueries(trpc.twoFactor.status.queryOptions());
  }

  return {
    status,
    isLoading,
    isEnrollOpen,
    onEnrollOpenChange: setIsEnrollOpen,
    onEnrollComplete,
    isDisableOpen,
    onDisableOpenChange: setIsDisableOpen,
    isRegenerateOpen,
    onRegenerateOpenChange: setIsRegenerateOpen,
    onRevokeTrusted: () => revokeMutation.mutate(),
    isRevoking: revokeMutation.isPending,
  };
}
