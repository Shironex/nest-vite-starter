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
import { useConfirmPasswordDialog } from './ConfirmPasswordDialog.hooks';
import type { IConfirmPasswordDialogProps } from './ConfirmPasswordDialog.types';

/**
 * The sudo prompt (SPEC section 8): a password re-entry dialog wired to
 * `auth.confirmPassword`, gating the email change. Chrome and the
 * reserved-message-row treatment follow DisableDialog, the sibling step-up
 * dialog.
 */
export default function ConfirmPasswordDialog(props: IConfirmPasswordDialogProps) {
  const { t } = useTranslation();
  const { form, onSubmit, isPending } = useConfirmPasswordDialog(props);

  const passwordForm = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>{t('auth.sudo.passwordLabel')}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder={t('auth.sudo.passwordPlaceholder')}
                  {...field}
                />
              </FormControl>
              {/*
                Reserved row, like DisableDialog: `mode: 'onBlur'` renders
                "Password is required" when the field loses focus, which is
                what pressing Cancel does; an unreserved row would push the
                footer down between mousedown and mouseup and the press would
                land on the form instead.
              */}
              <div className="min-h-5">
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            {t('actions.confirm')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="confirm-password-dialog">
        <DialogHeader>
          <DialogTitle>{t('auth.sudo.title')}</DialogTitle>
          <DialogDescription>{t('auth.sudo.description')}</DialogDescription>
        </DialogHeader>
        {passwordForm}
      </DialogContent>
    </Dialog>
  );
}
