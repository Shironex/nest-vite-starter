import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IDeleteUserDialogProps, IDeleteUserDialogView } from './DeleteUserDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useDeleteUserDialog({
  targetId,
  onOpenChange,
}: IDeleteUserDialogProps): IDeleteUserDialogView {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    ...trpc.user.adminDeleteUser.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.deleteDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to drop the deleted row from the table.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      // The audit list on the same page gains a row for this action.
      void queryClient.invalidateQueries(trpc.audit.list.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.deleteDialog.error),
  });

  function onConfirm() {
    deleteMutation.mutate({ userId: targetId });
  }

  return { onConfirm, isPending: deleteMutation.isPending };
}
