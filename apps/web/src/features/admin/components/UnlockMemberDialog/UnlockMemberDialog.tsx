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
import { useUnlockMemberDialog } from './UnlockMemberDialog.hooks';
import type { IUnlockMemberDialogProps } from './UnlockMemberDialog.types';

export default function UnlockMemberDialog(props: IUnlockMemberDialogProps) {
  const { t } = useTranslation();
  const { onConfirm, isPending } = useUnlockMemberDialog(props);

  const description = t('admin.unlockDialog.description', { email: props.email });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="unlock-member-dialog">
        <DialogHeader>
          <DialogTitle>{t('admin.unlockDialog.title')}</DialogTitle>
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
            {t('admin.unlockDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
