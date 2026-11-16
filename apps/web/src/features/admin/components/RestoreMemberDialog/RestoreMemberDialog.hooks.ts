import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IRestoreMemberDialogProps,
  IRestoreMemberDialogView,
} from './RestoreMemberDialog.types';

export function useRestoreMemberDialog({
  memberId,
  onOpenChange,
}: IRestoreMemberDialogProps): IRestoreMemberDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const restoreMutation = useMutation({
    ...trpc.user.restoreMember.mutationOptions(),
    onSuccess: () => {
      toast.success(t('admin.restoreDialog.success'));
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? t('admin.restoreDialog.error')),
  });

  function onConfirm() {
    restoreMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: restoreMutation.isPending };
}
