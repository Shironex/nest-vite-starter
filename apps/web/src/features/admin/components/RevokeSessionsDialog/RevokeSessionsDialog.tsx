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
import { useRevokeSessionsDialog } from './RevokeSessionsDialog.hooks';
import type { IRevokeSessionsDialogProps } from './RevokeSessionsDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings } from '@/lib/strings';

/**
 * Sign a user out everywhere. A default button, like disable: nothing about
 * the account changes and the user can sign straight back in, so it does not
 * wear the red reserved for deletion.
 */
export default function RevokeSessionsDialog(props: IRevokeSessionsDialogProps) {
  const { onConfirm, isPending } = useRevokeSessionsDialog(props);

  const description = adminStrings.revokeSessionsDialog.description({ email: props.email });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="revoke-sessions-dialog">
        <DialogHeader>
          <DialogTitle>{adminStrings.revokeSessionsDialog.title}</DialogTitle>
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
            {adminStrings.revokeSessionsDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
