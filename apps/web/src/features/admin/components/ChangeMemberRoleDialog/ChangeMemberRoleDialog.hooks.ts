import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { ROLES } from '@repo/shared/permissions';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IChangeMemberRoleDialogProps,
  IChangeMemberRoleDialogView,
} from './ChangeMemberRoleDialog.types';

export function useChangeMemberRoleDialog({
  memberId,
  memberRole,
  onOpenChange,
}: IChangeMemberRoleDialogProps): IChangeMemberRoleDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Only two roles exist, so the dialog always offers the other one.
  const nextRole = memberRole === ROLES.ADMIN ? ROLES.USER : ROLES.ADMIN;

  const { idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();

  const changeRoleMutation = useMutation({
    ...trpc.user.updateUserRole.mutationOptions({ trpc: { context: { idempotencyKey } } }),
    onSuccess: () => {
      resetIdempotencyKey();
      toast.success(t('admin.changeRoleDialog.success'));
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the role on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) => toast.error(translateAppError(error) ?? t('admin.changeRoleDialog.error')),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    changeRoleMutation.mutate({ userId: memberId, role: nextRole });
  }

  return {
    currentRoleLabel: t(`admin.roles.${memberRole}`, { defaultValue: memberRole }),
    nextRoleLabel: t(`admin.roles.${nextRole}`),
    onConfirm,
    isPending: changeRoleMutation.isPending,
  };
}
