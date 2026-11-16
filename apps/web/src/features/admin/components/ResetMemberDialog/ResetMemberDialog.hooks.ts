import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IResetMemberDialogProps, IResetMemberDialogView } from './ResetMemberDialog.types';

export function useResetMemberDialog({
  memberId,
  onOpenChange,
}: IResetMemberDialogProps): IResetMemberDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const resetMutation = useMutation({
    ...trpc.twoFactor.resetMemberTwoFactor.mutationOptions(),
    onSuccess: () => {
      toast.success(t('admin.resetDialog.success'));
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the badge on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? t('admin.resetDialog.error')),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    resetMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: resetMutation.isPending };
}
