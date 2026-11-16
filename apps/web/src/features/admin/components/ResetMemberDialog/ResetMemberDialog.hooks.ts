import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IResetMemberDialogProps, IResetMemberDialogView } from './ResetMemberDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useResetMemberDialog({
  memberId,
  onOpenChange,
}: IResetMemberDialogProps): IResetMemberDialogView {
  const queryClient = useQueryClient();

  const resetMutation = useMutation({
    ...trpc.twoFactor.resetUserTwoFactor.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.resetDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the badge on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.resetDialog.error),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    resetMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: resetMutation.isPending };
}
