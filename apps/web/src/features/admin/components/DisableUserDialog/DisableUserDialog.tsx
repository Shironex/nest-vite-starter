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
import { useDisableUserDialog } from './DisableUserDialog.hooks';
import type { IDisableUserDialogProps } from './DisableUserDialog.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings } from '@/lib/strings';

/**
 * The lighter of the two confirmations on this screen.
 *
 * A default button rather than a destructive one, deliberately: disabling is
 * reversible, keeps the account and its audit trail, and is undone from the
 * same menu. Dressing it in the red reserved for account deletion would teach
 * admins to hesitate over the safe action and then read past the color when
 * the irreversible one wears it.
 */
export default function DisableUserDialog(props: IDisableUserDialogProps) {
  const { onConfirm, isPending } = useDisableUserDialog(props);

  const description = adminStrings.disableDialog.description({ email: props.email });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="disable-user-dialog">
        <DialogHeader>
          <DialogTitle>{adminStrings.disableDialog.title}</DialogTitle>
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
            {adminStrings.disableDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
