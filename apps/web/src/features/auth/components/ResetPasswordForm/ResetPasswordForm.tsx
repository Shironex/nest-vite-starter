import { Link } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { Form } from '@repo/ui/form';
import { PasswordStrength } from '@/features/shared/components/PasswordStrength';
import {
  AUTH_LINK_CLASS,
  AUTH_MUTED_LINK_CLASS,
  AUTH_SUBMIT_CLASS,
} from '@/features/auth/Auth.constants';
import { AUTH_NS } from '@/features/auth/Auth.i18n';
import { AuthField } from '@/features/auth/components/AuthField';
import { FormError } from '@/features/auth/components/FormError';
import { useResetPasswordForm } from './ResetPasswordForm.hooks';

/**
 * The new-password screen. The design shows a "repeat password"
 * confirmation field and a static requirements checklist; `resetPasswordSchema`
 * has no confirmation field, and `PasswordStrength` already reports the same
 * requirements live, so both are covered by what is here rather than duplicated.
 */
export default function ResetPasswordForm() {
  const { t } = useTranslation(AUTH_NS);
  const {
    form,
    onSubmit,
    serverError,
    isPending,
    password,
    showRequestNewLink,
    requiresTwoFactor,
    isTokenMissing,
  } = useResetPasswordForm();

  const backToLogin = (
    <div className="text-center">
      <Link
        to="/auth/login"
        className={`inline-flex items-center gap-1.5 ${AUTH_MUTED_LINK_CLASS}`}
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t('backToSignIn')}
      </Link>
    </div>
  );

  /*
   * A missing token REPLACES the form rather than sitting above it: no password can make an absent token work, so
   * leaving the fields there invites an attempt that cannot succeed. It is
   * handled here rather than by `validateSearch` because a thrown
   * `validateSearch` is surfaced by TanStack as a route error, which is a red
   * error card instead of this sentence.
   */
  if (isTokenMissing) {
    return (
      <div className="grid gap-4">
        <p role="alert" className="type-body-regular text-danger">
          {t('resetPassword.tokenMissing')}
        </p>
        <div className="text-center">
          <Link to="/auth/forgot-password" className={`type-body-small ${AUTH_LINK_CLASS}`}>
            {t('resetPassword.requestNewLink')}
          </Link>
        </div>
        {backToLogin}
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        {serverError && (
          <FormError>
            {serverError}
            {showRequestNewLink && (
              <Link
                to="/auth/forgot-password"
                className={`mt-2 block type-body-small ${AUTH_LINK_CLASS}`}
              >
                {t('resetPassword.requestNewLink')}
              </Link>
            )}
          </FormError>
        )}

        <AuthField
          form={form}
          name="password"
          required
          label={t('resetPassword.newPassword')}
          type="password"
          placeholder={t('fields.newPasswordPlaceholder')}
          autoComplete="new-password"
        >
          <PasswordStrength password={password} />
        </AuthField>

        {requiresTwoFactor && (
          <AuthField
            form={form}
            name="factorCode"
            label={t('resetPassword.factorCode')}
            inputMode="text"
            placeholder={t('resetPassword.factorCodePlaceholder')}
            autoComplete="one-time-code"
          />
        )}

        <Button type="submit" className={AUTH_SUBMIT_CLASS} disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t('resetPassword.submit')}
        </Button>

        {backToLogin}
      </form>
    </Form>
  );
}
