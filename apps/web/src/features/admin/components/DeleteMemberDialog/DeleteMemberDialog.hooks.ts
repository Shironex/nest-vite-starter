import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IDeleteMemberDialogProps, IDeleteMemberDialogView } from './DeleteMemberDialog.types';

export function useDeleteMemberDialog({
  memberId,
  onOpenChange,
}: IDeleteMemberDialogProps): IDeleteMemberDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    ...trpc.user.adminDeleteUser.mutationOptions(),
    onSuccess: () => {
      toast.success(t('admin.deleteDialog.success'));
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to drop the deleted row from the table.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? t('admin.deleteDialog.error')),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    deleteMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: deleteMutation.isPending };
}
