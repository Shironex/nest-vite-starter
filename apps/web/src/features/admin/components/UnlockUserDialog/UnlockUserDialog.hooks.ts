import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IUnlockUserDialogProps, IUnlockUserDialogView } from './UnlockUserDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useUnlockUserDialog({
  targetId,
  onOpenChange,
}: IUnlockUserDialogProps): IUnlockUserDialogView {
  const queryClient = useQueryClient();

  const unlockMutation = useMutation({
    ...trpc.user.unlockUser.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.unlockDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the lock badge on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      // The audit list on the same page gains a row for this action.
      void queryClient.invalidateQueries(trpc.audit.list.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.unlockDialog.error),
  });

  function onConfirm() {
    unlockMutation.mutate({ userId: targetId });
  }

  return { onConfirm, isPending: unlockMutation.isPending };
}
