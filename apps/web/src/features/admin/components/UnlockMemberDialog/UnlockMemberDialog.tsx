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
import { useUnlockMemberDialog } from './UnlockMemberDialog.hooks';
import type { IUnlockMemberDialogProps } from './UnlockMemberDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings } from '@/lib/strings';

export default function UnlockMemberDialog(props: IUnlockMemberDialogProps) {
  const { onConfirm, isPending } = useUnlockMemberDialog(props);

  const description = adminStrings.unlockDialog.description({ email: props.email });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="unlock-member-dialog">
        <DialogHeader>
          <DialogTitle>{adminStrings.unlockDialog.title}</DialogTitle>
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
            {adminStrings.unlockDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
