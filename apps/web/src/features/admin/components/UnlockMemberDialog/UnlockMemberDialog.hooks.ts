import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { translateAppError } from '@/lib/trpc-errors';
import type { IUnlockMemberDialogProps, IUnlockMemberDialogView } from './UnlockMemberDialog.types';

export function useUnlockMemberDialog({
  memberId,
  onOpenChange,
}: IUnlockMemberDialogProps): IUnlockMemberDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();

  const unlockMutation = useMutation({
    ...trpc.user.unlockUser.mutationOptions({ trpc: { context: { idempotencyKey } } }),
    onSuccess: () => {
      resetIdempotencyKey();
      toast.success(t('admin.unlockDialog.success'));
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the lock badge on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? t('admin.unlockDialog.error')),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    unlockMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: unlockMutation.isPending };
}
