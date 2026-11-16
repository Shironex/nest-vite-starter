import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/dialog';
import { useRevokeInviteDialog } from './RevokeInviteDialog.hooks';
import type { IRevokeInviteDialogProps } from './RevokeInviteDialog.types';

/**
 * Withdrawing an invitation nobody accepted.
 *
 * Destructive styling, unlike removal: the pending row is hard-deleted and the
 * link stops working, so there is nothing to restore. It is safe precisely
 * because an account that never had a password was never an actor on anything,
 * but from the admin's side it is still a one-way door.
 */
export default function RevokeInviteDialog(props: IRevokeInviteDialogProps) {
  const { t } = useTranslation();
  const { onConfirm, isPending } = useRevokeInviteDialog(props);

  const description = t('admin.revokeInviteDialog.description', { email: props.email });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="revoke-invite-dialog">
        <DialogHeader>
          <DialogTitle>{t('admin.revokeInviteDialog.title')}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('admin.revokeInviteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
