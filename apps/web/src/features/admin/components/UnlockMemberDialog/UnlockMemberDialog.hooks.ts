import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IUnlockMemberDialogProps, IUnlockMemberDialogView } from './UnlockMemberDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useUnlockMemberDialog({
  memberId,
  onOpenChange,
}: IUnlockMemberDialogProps): IUnlockMemberDialogView {
  const queryClient = useQueryClient();

  const unlockMutation = useMutation({
    ...trpc.user.unlockUser.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.unlockDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the lock badge on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.unlockDialog.error),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    unlockMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: unlockMutation.isPending };
}
