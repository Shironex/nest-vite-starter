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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { Input } from '@repo/ui/input';
import { useWithdrawInviteByEmailDialog } from './WithdrawInviteByEmailDialog.hooks';
import type { IWithdrawInviteByEmailDialogProps } from './WithdrawInviteByEmailDialog.types';

/**
 * Withdrawing an invitation the members table cannot show.
 *
 * An invitation to somebody who already works in another organization has no row
 * here: it lives only as a link against their existing account. So the admin
 * types the address instead of clicking a row, and the description says which
 * invitations this reaches and which it does not, because the ones in the
 * table are withdrawn from their row and typing one of those here does nothing.
 */
export default function WithdrawInviteByEmailDialog(props: IWithdrawInviteByEmailDialogProps) {
  const { t } = useTranslation();
  const { form, onSubmit, isPending } = useWithdrawInviteByEmailDialog(props);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="withdraw-invite-by-email-dialog">
        <DialogHeader>
          <DialogTitle>{t('admin.withdrawInviteByEmailDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('admin.withdrawInviteByEmailDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{t('admin.withdrawInviteByEmailDialog.emailLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="off"
                      placeholder={t('admin.withdrawInviteByEmailDialog.emailPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  {/* Reserved row, so a validation message cannot move the
                      submit button between mousedown and mouseup. */}
                  <div className="min-h-5">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <p className="type-body-small text-text-muted">
              {t('admin.withdrawInviteByEmailDialog.consequence')}
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => props.onOpenChange(false)}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" variant="destructive" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                {t('admin.withdrawInviteByEmailDialog.confirm')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
