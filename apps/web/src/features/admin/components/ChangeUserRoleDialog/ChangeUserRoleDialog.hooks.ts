import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { ROLES } from '@repo/shared/permissions';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IChangeUserRoleDialogProps,
  IChangeUserRoleDialogView,
} from './ChangeUserRoleDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { labelFor } from '@/lib/strings';

export function useChangeUserRoleDialog({
  targetId,
  userRole,
  onOpenChange,
}: IChangeUserRoleDialogProps): IChangeUserRoleDialogView {
  const queryClient = useQueryClient();

  // Only two roles exist, so the dialog always offers the other one.
  const nextRole = userRole === ROLES.ADMIN ? ROLES.USER : ROLES.ADMIN;

  const changeRoleMutation = useMutation({
    ...trpc.user.updateUserRole.mutationOptions(),
    onSuccess: () => {
      toast.success(adminStrings.changeRoleDialog.success);
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers query family to refresh the role on the affected row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      // The audit list on the same page gains a row for this action.
      void queryClient.invalidateQueries(trpc.audit.list.pathFilter());
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(translateAppError(error) ?? adminStrings.changeRoleDialog.error),
  });

  function onConfirm() {
    changeRoleMutation.mutate({ userId: targetId, role: nextRole });
  }

  return {
    currentRoleLabel: labelFor(adminStrings.roles, userRole),
    nextRoleLabel: labelFor(adminStrings.roles, nextRole),
    onConfirm,
    isPending: changeRoleMutation.isPending,
  };
}
