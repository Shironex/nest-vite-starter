import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { translateAppError } from '@/lib/trpc-errors';
import type { IRemoveMemberDialogProps, IRemoveMemberDialogView } from './RemoveMemberDialog.types';

export function useRemoveMemberDialog({
  memberId,
  onOpenChange,
}: IRemoveMemberDialogProps): IRemoveMemberDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();

  const removeMutation = useMutation({
    ...trpc.user.removeMember.mutationOptions({ trpc: { context: { idempotencyKey } } }),
    onSuccess: () => {
      resetIdempotencyKey();
      toast.success(t('admin.removeDialog.success'));
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers family: the row stays, with its status changed to `removed`.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? t('admin.removeDialog.error')),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    removeMutation.mutate({ userId: memberId });
  }

  return { onConfirm, isPending: removeMutation.isPending };
}
