import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { staffInviteWithdrawByEmailSchema } from '@repo/shared/schemas';
import type { StaffInviteWithdrawByEmailInput } from '@repo/shared/schemas';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IWithdrawInviteByEmailDialogProps,
  IWithdrawInviteByEmailDialogView,
} from './WithdrawInviteByEmailDialog.types';

/**
 * Withdraw an invitation that would move an account from another organization.
 *
 * The api acks identically whether or not anything was open, and this hook
 * keeps it that way: one success message, worded conditionally, and no list
 * to refresh. Saying "withdrawn" for one address and "nothing to withdraw" for
 * another would tell the admin which addresses have an account elsewhere.
 */
export function useWithdrawInviteByEmailDialog({
  onOpenChange,
}: IWithdrawInviteByEmailDialogProps): IWithdrawInviteByEmailDialogView {
  const { t } = useTranslation();

  const form = useForm<StaffInviteWithdrawByEmailInput>({
    resolver: zodResolver(staffInviteWithdrawByEmailSchema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  const { idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();

  const withdrawMutation = useMutation({
    ...trpc.staffInvite.withdrawByEmail.mutationOptions({
      trpc: { context: { idempotencyKey } },
    }),
    onSuccess: (_result, variables) => {
      resetIdempotencyKey();
      toast.success(t('admin.withdrawInviteByEmailDialog.success', { email: variables.email }));
      form.reset();
      onOpenChange(false);
    },
    // Stays open on failure, typed address intact: a refusal (no active organization,
    // a caller who is not an admin) is exactly the case where nothing was withdrawn.
    onError: (error) =>
      toast.error(translateAppError(error) ?? t('admin.withdrawInviteByEmailDialog.error')),
  });

  function onSubmit(data: StaffInviteWithdrawByEmailInput) {
    withdrawMutation.mutate(data);
  }

  return { form, onSubmit, isPending: withdrawMutation.isPending };
}
