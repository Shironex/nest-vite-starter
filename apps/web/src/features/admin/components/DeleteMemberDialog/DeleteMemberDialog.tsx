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
import { useDeleteMemberDialog } from './DeleteMemberDialog.hooks';
import type { IDeleteMemberDialogProps } from './DeleteMemberDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings } from '@/lib/strings';

export default function DeleteMemberDialog(props: IDeleteMemberDialogProps) {
  const { onConfirm, isPending } = useDeleteMemberDialog(props);

  const description = adminStrings.deleteDialog.description({ email: props.email });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="delete-member-dialog">
        <DialogHeader>
          <DialogTitle>{adminStrings.deleteDialog.title}</DialogTitle>
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
          <Button type="button" variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending && <Loader2 className="animate-spin" />}
            {adminStrings.deleteDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
