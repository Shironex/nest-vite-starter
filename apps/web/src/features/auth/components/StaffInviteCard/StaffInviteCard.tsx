import { Link } from '@tanstack/react-router';
import { ArrowLeft, Loader2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { Input } from '@repo/ui/input';
import { Spinner } from '@repo/ui/spinner';
import { PasswordStrength } from '@/features/shared/components/PasswordStrength';
import { useStaffInviteCard } from './StaffInviteCard.hooks';

/**
 * Accepting an invitation into an organization.
 *
 * ONE FIELD FOR THE PASSWORD, AND NO CONFIRMATION FIELD: the schema has none
 * and `PasswordStrength` reports every requirement live, so a second box would
 * be a rule the server does not have and copy that can disagree with the
 * checklist beside it. Same call `ResetPasswordForm` makes.
 *
 * The move warning sits ABOVE the fields, not below them. Accepting on that
 * path closes the organization the reader is in today, and a consequence disclosed
 * after the call to action is not disclosed.
 */
export default function StaffInviteCard() {
  const { t } = useTranslation();
  const v = useStaffInviteCard();

  const backToLogin = (
    <div className="text-center">
      <Link
        to="/auth/login"
        className="inline-flex items-center gap-1.5 type-body-small text-text-muted hover:text-text"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t('auth.staffInvite.backToLogin')}
      </Link>
    </div>
  );

  if (v.state === 'checking') {
    return (
      <div className="flex items-center justify-center gap-2 py-6 type-body-regular text-text-muted">
        <Spinner className="size-4" />
        {t('auth.staffInvite.checking')}
      </div>
    );
  }

  if (v.state === 'failed') {
    return (
      <div className="grid gap-4">
        <p role="alert" className="type-body-regular text-danger">
          {t('auth.staffInvite.checkError')}
        </p>
        <Button type="button" variant="outline" onClick={v.onRetry}>
          {t('actions.retry')}
        </Button>
        {backToLogin}
      </div>
    );
  }

  if (v.state === 'invalid' || v.isLinkDead) {
    return (
      <div className="grid gap-4">
        <p role="alert" className="type-body-regular text-danger">
          {t('auth.staffInvite.invalidLink')}
        </p>
        <p className="type-body-small text-text-muted">{t('auth.staffInvite.invalidHelp')}</p>
        {backToLogin}
      </div>
    );
  }

  const moveWarning = !v.movesExistingAccount ? null : (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md bg-warning-bg p-3 type-body-small text-warning"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {t('auth.staffInvite.movesAccount')}
    </p>
  );

  const factorField = !v.requiresTwoFactor ? null : (
    <FormField
      control={v.form.control}
      name="factorCode"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('auth.staffInvite.codeLabel')}</FormLabel>
          <FormControl>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t('auth.staffInvite.codePlaceholder')}
              {...field}
            />
          </FormControl>
          <p className="type-body-small text-text-muted">{t('auth.staffInvite.codeHelp')}</p>
          <div className="min-h-5">
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  );

  const serverError =
    v.serverError === null ? null : (
      <p role="alert" className="type-body-small text-danger">
        {v.serverError}
      </p>
    );

  return (
    <Form {...v.form}>
      <form onSubmit={v.form.handleSubmit(v.onSubmit)} className="grid gap-4">
        {moveWarning}

        <FormField
          control={v.form.control}
          name="password"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>{t('auth.staffInvite.passwordLabel')}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('auth.staffInvite.passwordPlaceholder')}
                  {...field}
                />
              </FormControl>
              {/* Reserved row, so a validation message cannot move the submit
                  button between mousedown and mouseup. */}
              <div className="min-h-5">
                <FormMessage />
              </div>
              <PasswordStrength password={v.password} />
            </FormItem>
          )}
        />

        {factorField}
        {serverError}

        <Button type="submit" disabled={v.isPending}>
          {v.isPending && <Loader2 className="animate-spin" />}
          {t('auth.staffInvite.submit')}
        </Button>

        {/* Acceptance mints no session, so the next step is a normal sign-in
            rather than a redirect into the app. */}
        <p className="text-center type-body-small text-text-muted">
          {t('auth.staffInvite.thenSignIn')}
        </p>
      </form>
    </Form>
  );
}
