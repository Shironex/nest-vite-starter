import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IUnlockMemberDialogProps, IUnlockMemberDialogView } from './UnlockMemberDialog.types';

export function useUnlockMemberDialog({
  memberId,
  onOpenChange,
}: IUnlockMemberDialogProps): IUnlockMemberDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const unlockMutation = useMutation({
    ...trpc.user.unlockUser.mutationOptions(),
    onSuccess: () => {
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
