import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IRemoveMemberDialogProps, IRemoveMemberDialogView } from './RemoveMemberDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useRemoveMemberDialog({
  memberId,
  onOpenChange,
}: IRemoveMemberDialogProps): IRemoveMemberDialogView {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    ...trpc.user.removeMember.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.removeDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers family: the row stays, with its status changed to `removed`.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.removeDialog.error),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    removeMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: removeMutation.isPending };
}
