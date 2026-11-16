import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Form } from '@repo/ui/form';
import { AUTH_MUTED_LINK_CLASS } from '@/features/auth/Auth.constants';
import { AUTH_NS } from '@/features/auth/Auth.i18n';
import { AuthField } from '@/features/auth/components/AuthField';
import { TurnstileField } from '@/features/auth/components/TurnstileField';
import { AuthSubmit } from '@/features/auth/components/AuthSubmit';
import { FormError } from '@/features/auth/components/FormError';
import { useForgotPasswordForm } from './ForgotPasswordForm.hooks';

/** The forgot-password screen: one email field and a link back to sign-in. */
export default function ForgotPasswordForm() {
  const { t } = useTranslation(AUTH_NS);
  const {
    form,
    onSubmit,
    submitted,
    serverError,
    isPending,
    confirmationRef,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  } = useForgotPasswordForm();

  const backToSignIn = (
    <Link to="/auth/login" className={`inline-flex items-center gap-1.5 ${AUTH_MUTED_LINK_CLASS}`}>
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {t('backToSignIn')}
    </Link>
  );

  return submitted ? (
    <div
      ref={confirmationRef}
      role="status"
      tabIndex={-1}
      className="grid justify-items-center gap-4 text-center outline-none"
    >
      <p className="type-body-regular text-text-secondary">{t('forgotPassword.sent')}</p>
      {backToSignIn}
    </div>
  ) : (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        {serverError && <FormError>{serverError}</FormError>}

        <AuthField
          form={form}
          name="email"
          required
          label={t('fields.email')}
          type="email"
          placeholder={t('fields.emailPlaceholder')}
          autoComplete="email"
        />

        <TurnstileField
          form={form}
          turnstileRef={turnstileRef}
          onStatusChange={onCaptchaStatusChange}
        />

        <AuthSubmit isPending={isPending} captchaStatus={captchaStatus}>
          {t('forgotPassword.submit')}
        </AuthSubmit>

        <div className="text-center">{backToSignIn}</div>
      </form>
    </Form>
  );
}
