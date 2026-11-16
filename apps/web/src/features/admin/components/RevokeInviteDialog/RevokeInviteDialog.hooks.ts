import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { translateAppError } from '@/lib/trpc-errors';
import type { IRevokeInviteDialogProps, IRevokeInviteDialogView } from './RevokeInviteDialog.types';

export function useRevokeInviteDialog({
  memberId,
  onOpenChange,
}: IRevokeInviteDialogProps): IRevokeInviteDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();

  const revokeMutation = useMutation({
    ...trpc.staffInvite.revoke.mutationOptions({ trpc: { context: { idempotencyKey } } }),
    onSuccess: () => {
      resetIdempotencyKey();
      toast.success(t('admin.revokeInviteDialog.success'));
      // The pending row is hard-deleted, so it leaves the table entirely.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(translateAppError(error) ?? t('admin.revokeInviteDialog.error')),
  });

  function onConfirm() {
    revokeMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: revokeMutation.isPending };
}
