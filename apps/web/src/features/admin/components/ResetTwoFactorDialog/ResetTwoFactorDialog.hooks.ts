import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IResetTwoFactorDialogProps,
  IResetTwoFactorDialogView,
} from './ResetTwoFactorDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useResetTwoFactorDialog({
  targetId,
  onOpenChange,
}: IResetTwoFactorDialogProps): IResetTwoFactorDialogView {
  const queryClient = useQueryClient();

  const resetMutation = useMutation({
    ...trpc.twoFactor.resetUserTwoFactor.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.resetDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the badge on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      // The audit list on the same page gains a row for this action.
      void queryClient.invalidateQueries(trpc.audit.list.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.resetDialog.error),
  });

  function onConfirm() {
    resetMutation.mutate({ userId: targetId });
  }

  return { onConfirm, isPending: resetMutation.isPending };
}
