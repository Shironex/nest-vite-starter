import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IRestoreMemberDialogProps,
  IRestoreMemberDialogView,
} from './RestoreMemberDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useRestoreMemberDialog({
  memberId,
  onOpenChange,
}: IRestoreMemberDialogProps): IRestoreMemberDialogView {
  const queryClient = useQueryClient();

  const restoreMutation = useMutation({
    ...trpc.user.restoreMember.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.restoreDialog.success);
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? adminStrings.restoreDialog.error),
  });

  function onConfirm() {
    restoreMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: restoreMutation.isPending };
}
