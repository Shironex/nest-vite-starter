import { Loader2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
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
import { AUTH_LINK_CLASS } from '@/features/auth/Auth.constants';
import { useConfirmPasswordDialog } from './ConfirmPasswordDialog.hooks';
import type { IConfirmPasswordDialogProps } from './ConfirmPasswordDialog.types';

/**
 * The sudo prompt (SPEC section 8): a password re-entry dialog wired to
 * `auth.confirmPassword`, gating both OAuth link and unlink. Chrome and the
 * reserved-message-row treatment follow DisableDialog, the sibling step-up
 * dialog.
 *
 * An OAuth-only account has no password to re-enter, so after the api answers
 * PASSWORD_NOT_SET the form gives way to an explanation and the password-reset
 * route (reset doubles as set-password).
 */
export default function ConfirmPasswordDialog(props: IConfirmPasswordDialogProps) {
  const { t } = useTranslation();
  const { form, onSubmit, isPending, hasNoPassword } = useConfirmPasswordDialog(props);

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

  const noPasswordBody = (
    <div className="space-y-4">
      <p className="type-body-small text-text-muted">{t('auth.sudo.noPassword')}</p>
      <Link to="/auth/forgot-password" className={AUTH_LINK_CLASS}>
        {t('auth.sudo.noPasswordCta')}
      </Link>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
          {t('actions.close')}
        </Button>
      </DialogFooter>
    </div>
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="confirm-password-dialog">
        <DialogHeader>
          <DialogTitle>{t('auth.sudo.title')}</DialogTitle>
          <DialogDescription>{t('auth.sudo.description')}</DialogDescription>
        </DialogHeader>
        {hasNoPassword ? noPasswordBody : passwordForm}
      </DialogContent>
    </Dialog>
  );
}
