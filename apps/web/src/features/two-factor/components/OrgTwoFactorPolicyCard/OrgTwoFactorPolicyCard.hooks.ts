import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { formatDate } from '@/lib/i18n/format';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IOrgTwoFactorPolicyCardView } from './OrgTwoFactorPolicyCard.types';

// The app's date formatter, not the browser locale: the deadline reads in the
// app locale like every other date on screen.
function formatDeadlineDate(graceEndsAt: Date | null, required: boolean): string | null {
  if (!required || !graceEndsAt) return null;
  return formatDate(graceEndsAt);
}

export function useOrgTwoFactorPolicyCard(): IOrgTwoFactorPolicyCardView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: policy, isLoading } = useQuery({
    ...trpc.twoFactor.getTenantPolicy.queryOptions(),
  });
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false);

  const setPolicyMutation = useMutation({
    ...trpc.twoFactor.setTenantPolicy.mutationOptions(),
    onSuccess: (result) => {
      toast.success(
        result.required
          ? t('twoFactor.orgPolicy.enabledToast')
          : t('twoFactor.orgPolicy.disabledToast'),
      );
      // Refetch the policy card, and the personal status query the grace banner reads.
      void queryClient.invalidateQueries(trpc.twoFactor.getTenantPolicy.queryOptions());
      void queryClient.invalidateQueries(trpc.twoFactor.status.queryOptions());
    },
    onError: (error) =>
      toast.error(translateAppError(error) ?? t('twoFactor.orgPolicy.updateFailed')),
  });

  function onToggle(next: boolean) {
    // Enabling starts a 7-day grace and emails every non-enrolled member, so it
    // is confirmed; disabling is low-risk and applies immediately.
    if (next) {
      setConfirmEnableOpen(true);
    } else {
      setPolicyMutation.mutate({ required: false });
    }
  }

  function onConfirmEnable() {
    setConfirmEnableOpen(false);
    setPolicyMutation.mutate({ required: true });
  }

  const required = policy?.required ?? false;
  const deadlineDate = formatDeadlineDate(policy?.graceEndsAt ?? null, required);

  return {
    policy,
    isLoading,
    required,
    enforced: policy?.enforced ?? false,
    statusText: required
      ? t('twoFactor.orgPolicy.statusRequired')
      : t('twoFactor.orgPolicy.statusNotRequired'),
    deadlineText: deadlineDate ? t('twoFactor.orgPolicy.deadline', { date: deadlineDate }) : null,
    confirmEnableOpen,
    onConfirmEnableOpenChange: setConfirmEnableOpen,
    onToggle,
    onConfirmEnable,
    isPending: setPolicyMutation.isPending,
  };
}
