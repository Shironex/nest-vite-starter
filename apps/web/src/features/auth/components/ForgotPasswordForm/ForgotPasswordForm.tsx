import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Form } from '@repo/ui/form';
import { AUTH_MUTED_LINK_CLASS } from '@/features/auth/Auth.constants';
import { AuthField } from '@/features/auth/components/AuthField';
import { TurnstileField } from '@/features/auth/components/TurnstileField';
import { AuthSubmit } from '@/features/auth/components/AuthSubmit';
import { FormError } from '@/features/auth/components/FormError';
import { useForgotPasswordForm } from './ForgotPasswordForm.hooks';
import { authStrings } from '@/features/auth/Auth.strings';

/** The forgot-password screen: one email field and a link back to sign-in. */
export default function ForgotPasswordForm() {
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
      {authStrings.backToSignIn}
    </Link>
  );

  return submitted ? (
    <div
      ref={confirmationRef}
      role="status"
      tabIndex={-1}
      className="grid justify-items-center gap-4 text-center outline-none"
    >
      <p className="type-body-regular text-text-secondary">{authStrings.forgotPassword.sent}</p>
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
          label={authStrings.fields.email}
          type="email"
          placeholder={authStrings.fields.emailPlaceholder}
          autoComplete="email"
        />

        <TurnstileField
          form={form}
          turnstileRef={turnstileRef}
          onStatusChange={onCaptchaStatusChange}
        />

        <AuthSubmit isPending={isPending} captchaStatus={captchaStatus}>
          {authStrings.forgotPassword.submit}
        </AuthSubmit>

        <div className="text-center">{backToSignIn}</div>
      </form>
    </Form>
  );
}
