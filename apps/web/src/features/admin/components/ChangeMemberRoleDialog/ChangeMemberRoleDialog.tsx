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
import { useChangeMemberRoleDialog } from './ChangeMemberRoleDialog.hooks';
import type { IChangeMemberRoleDialogProps } from './ChangeMemberRoleDialog.types';

export default function ChangeMemberRoleDialog(props: IChangeMemberRoleDialogProps) {
  const { t } = useTranslation();
  const { currentRoleLabel, nextRoleLabel, onConfirm, isPending } =
    useChangeMemberRoleDialog(props);

  const description = t('admin.changeRoleDialog.description', {
    email: props.email,
    currentRole: currentRoleLabel,
    nextRole: nextRoleLabel,
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="change-member-role-dialog">
        <DialogHeader>
          <DialogTitle>{t('admin.changeRoleDialog.title')}</DialogTitle>
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
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('admin.changeRoleDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
