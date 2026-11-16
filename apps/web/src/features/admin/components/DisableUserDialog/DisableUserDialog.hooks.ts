import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IDisableUserDialogProps, IDisableUserDialogView } from './DisableUserDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useDisableUserDialog({
  targetId,
  onOpenChange,
}: IDisableUserDialogProps): IDisableUserDialogView {
  const queryClient = useQueryClient();

  const disableMutation = useMutation({
    ...trpc.user.disableUser.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.disableDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers family: the row stays, with its status changed to disabled.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      // The audit list on the same page gains a row for this action.
      void queryClient.invalidateQueries(trpc.audit.list.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.disableDialog.error),
  });

  function onConfirm() {
    disableMutation.mutate({ userId: targetId });
  }

  return { onConfirm, isPending: disableMutation.isPending };
}
