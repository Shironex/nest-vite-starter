import { Loader2 } from 'lucide-react';
import { Button } from '@repo/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/dialog';
import { useChangeUserRoleDialog } from './ChangeUserRoleDialog.hooks';
import type { IChangeUserRoleDialogProps } from './ChangeUserRoleDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings } from '@/lib/strings';

export default function ChangeUserRoleDialog(props: IChangeUserRoleDialogProps) {
  const { currentRoleLabel, nextRoleLabel, onConfirm, isPending } = useChangeUserRoleDialog(props);

  const description = adminStrings.changeRoleDialog.description({
    email: props.email,
    currentRole: currentRoleLabel,
    nextRole: nextRoleLabel,
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="change-user-role-dialog">
        <DialogHeader>
          <DialogTitle>{adminStrings.changeRoleDialog.title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {commonStrings.actions.cancel}
          </Button>
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            {isPending && <Loader2 className="animate-spin" />}
            {adminStrings.changeRoleDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
