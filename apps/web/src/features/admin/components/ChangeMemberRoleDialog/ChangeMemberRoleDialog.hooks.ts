import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { ROLES } from '@repo/shared/permissions';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IChangeMemberRoleDialogProps,
  IChangeMemberRoleDialogView,
} from './ChangeMemberRoleDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { labelFor } from '@/lib/strings';

export function useChangeMemberRoleDialog({
  memberId,
  memberRole,
  onOpenChange,
}: IChangeMemberRoleDialogProps): IChangeMemberRoleDialogView {
  const queryClient = useQueryClient();

  // Only two roles exist, so the dialog always offers the other one.
  const nextRole = memberRole === ROLES.ADMIN ? ROLES.USER : ROLES.ADMIN;

  const changeRoleMutation = useMutation({
    ...trpc.user.updateUserRole.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.changeRoleDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the role on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(translateAppError(error) ?? adminStrings.changeRoleDialog.error),
  });

  function onConfirm() {
    // The prop is `memberId` (visual/identity naming rule); the backend contract
    // still expects the field `userId`.
    changeRoleMutation.mutate({ userId: memberId, role: nextRole });
  }

  return {
    currentRoleLabel: labelFor(adminStrings.roles, memberRole),
    nextRoleLabel: labelFor(adminStrings.roles, nextRole),
    onConfirm,
    isPending: changeRoleMutation.isPending,
  };
}
