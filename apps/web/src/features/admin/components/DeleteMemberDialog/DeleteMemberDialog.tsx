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
import { useDeleteMemberDialog } from './DeleteMemberDialog.hooks';
import type { IDeleteMemberDialogProps } from './DeleteMemberDialog.types';

export default function DeleteMemberDialog(props: IDeleteMemberDialogProps) {
  const { t } = useTranslation();
  const { onConfirm, isPending } = useDeleteMemberDialog(props);

  const description = t('admin.deleteDialog.description', { email: props.email });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="delete-member-dialog">
        <DialogHeader>
          <DialogTitle>{t('admin.deleteDialog.title')}</DialogTitle>
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
            {t('admin.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
