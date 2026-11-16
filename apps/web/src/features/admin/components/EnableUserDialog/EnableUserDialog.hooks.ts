import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IEnableUserDialogProps, IEnableUserDialogView } from './EnableUserDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useEnableUserDialog({
  targetId,
  onOpenChange,
}: IEnableUserDialogProps): IEnableUserDialogView {
  const queryClient = useQueryClient();

  const enableMutation = useMutation({
    ...trpc.user.enableUser.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.enableDialog.success);
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      // The audit list on the same page gains a row for this action.
      void queryClient.invalidateQueries(trpc.audit.list.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.enableDialog.error),
  });

  function onConfirm() {
    enableMutation.mutate({ userId: targetId });
  }

  return { onConfirm, isPending: enableMutation.isPending };
}
