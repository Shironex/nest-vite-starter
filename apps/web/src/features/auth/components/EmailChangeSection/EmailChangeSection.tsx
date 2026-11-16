import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { Input } from '@repo/ui/input';
import { ConfirmPasswordDialog } from '../ConfirmPasswordDialog';
import { FormSuccess } from '../FormSuccess';
import { useEmailChangeSection } from './EmailChangeSection.hooks';

/**
 * The settings card that starts a verified email change. Chrome follows
 * PasswordSection, its settings sibling; the sudo dialog and the
 * attempt-first FORBIDDEN retry follow ConnectedAccountsSection, the sibling
 * that already re-proves the password for account surgery.
 *
 * Nothing changes on submit: the api only mails a confirmation link to the
 * NEW address (and a tripwire to the old one), which the success banner
 * spells out so nobody expects an instant switch.
 */
export default function EmailChangeSection() {
  const { t } = useTranslation();
  const {
    currentEmail,
    form,
    onSubmit,
    isPending,
    requiresFactorCode,
    hasLinkedAccounts,
    pendingSentTo,
    isDialogOpen,
    onDialogOpenChange,
    onSudoConfirmed,
  } = useEmailChangeSection();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('auth.emailChange.title')}</CardTitle>
        <CardDescription>{t('auth.emailChange.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="type-body-small text-text-muted">{t('auth.emailChange.currentLabel')}</p>
          <p className="type-body-medium text-text">{currentEmail}</p>
        </div>

        {pendingSentTo !== null && (
          <FormSuccess>{t('auth.emailChange.pendingSent', { email: pendingSentTo })}</FormSuccess>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newEmail"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{t('auth.emailChange.newLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder={t('auth.emailChange.newPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  {/*
                    Reserved row, like the PasswordSection fields: `mode:
                    'onBlur'` renders the message when the field loses focus,
                    which is what pressing the submit button does; an
                    unreserved row would push the button down between
                    mousedown and mouseup.
                  */}
                  <div className="min-h-5">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            {requiresFactorCode && (
              <FormField
                control={form.control}
                name="factorCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.emailChange.factorLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="one-time-code"
                        placeholder={t('auth.emailChange.factorPlaceholder')}
                        {...field}
                      />
                    </FormControl>
                    <p className="type-body-small text-text-muted">
                      {t('auth.emailChange.factorHint')}
                    </p>
                    {/* Reserved row, same reason as the address field above. */}
                    <div className="min-h-5">
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            )}

            {hasLinkedAccounts && (
              <p className="type-body-small text-text-muted">{t('auth.emailChange.oauthNote')}</p>
            )}

            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              {t('auth.emailChange.submit')}
            </Button>
          </form>
        </Form>
      </CardContent>

      <ConfirmPasswordDialog
        open={isDialogOpen}
        onOpenChange={onDialogOpenChange}
        onConfirmed={onSudoConfirmed}
      />
    </Card>
  );
}
