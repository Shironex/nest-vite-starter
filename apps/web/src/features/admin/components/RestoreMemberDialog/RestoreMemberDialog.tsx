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
import { useRestoreMemberDialog } from './RestoreMemberDialog.hooks';
import type { IRestoreMemberDialogProps } from './RestoreMemberDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings } from '@/lib/strings';

/**
 * Confirmed rather than a bare menu click, even though it undoes a reversible
 * act: restoring somebody hands their sessions and their reach back, and for a
 * former ADMIN it is a privilege grant that never passes through the role
 * dialog. A grant deserves the same beat of hesitation wherever it happens.
 */
export default function RestoreMemberDialog(props: IRestoreMemberDialogProps) {
  const { onConfirm, isPending } = useRestoreMemberDialog(props);

  const description = adminStrings.restoreDialog.description({ email: props.email });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="restore-member-dialog">
        <DialogHeader>
          <DialogTitle>{adminStrings.restoreDialog.title}</DialogTitle>
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
            {adminStrings.restoreDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
