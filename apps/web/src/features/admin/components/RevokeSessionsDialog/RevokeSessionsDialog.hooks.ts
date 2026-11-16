import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IRevokeSessionsDialogProps,
  IRevokeSessionsDialogView,
} from './RevokeSessionsDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';

export function useRevokeSessionsDialog({
  targetId,
  onOpenChange,
}: IRevokeSessionsDialogProps): IRevokeSessionsDialogView {
  const queryClient = useQueryClient();

  const revokeMutation = useMutation({
    ...trpc.user.revokeUserSessions.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.revokeSessionsDialog.success);
      // Nothing on the row changes, but the audit list below gains a row.
      void queryClient.invalidateQueries(trpc.audit.list.pathFilter());
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(translateAppError(error) ?? adminStrings.revokeSessionsDialog.error),
  });

  function onConfirm() {
    revokeMutation.mutate({ userId: targetId });
  }

  return { onConfirm, isPending: revokeMutation.isPending };
}
