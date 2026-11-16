import { useTranslation } from 'react-i18next';
import { Form } from '@repo/ui/form';
import { PasswordStrength } from '@/features/shared/components/PasswordStrength';
import { AUTH_NS } from '@/features/auth/Auth.i18n';
import { AuthField } from '@/features/auth/components/AuthField';
import { TurnstileField } from '@/features/auth/components/TurnstileField';
import { AuthSubmit } from '@/features/auth/components/AuthSubmit';
import { FormError } from '@/features/auth/components/FormError';
import { OAuthButtons } from '@/features/auth/components/OAuthButtons';
import { OAuthErrorAlert } from '@/features/auth/components/OAuthErrorAlert';
import { useRegisterForm } from './RegisterForm.hooks';

/**
 * The registration screen, restricted to the fields the register mutation
 * actually accepts. The design additionally shows a first/last name pair and a
 * terms checkbox; neither exists in `registerSchema`, so they are
 * left out rather than stubbed into inputs that go nowhere.
 */
export default function RegisterForm() {
  const { t } = useTranslation(AUTH_NS);
  const {
    form,
    onSubmit,
    serverError,
    isPending,
    password,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  } = useRegisterForm();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        {serverError && <FormError>{serverError}</FormError>}
        <OAuthErrorAlert />

        <AuthField
          form={form}
          name="email"
          required
          label={t('register.workEmail')}
          type="email"
          placeholder={t('fields.emailPlaceholder')}
          autoComplete="email"
        />

        <AuthField
          form={form}
          name="displayName"
          label={t('register.displayName')}
          placeholder={t('register.displayNamePlaceholder')}
          autoComplete="name"
        />

        <AuthField
          form={form}
          name="password"
          required
          label={t('fields.password')}
          type="password"
          placeholder={t('fields.newPasswordPlaceholder')}
          autoComplete="new-password"
        >
          <PasswordStrength password={password} />
        </AuthField>

        <TurnstileField
          form={form}
          turnstileRef={turnstileRef}
          onStatusChange={onCaptchaStatusChange}
        />

        <AuthSubmit isPending={isPending} captchaStatus={captchaStatus}>
          {t('register.submit')}
        </AuthSubmit>

        <OAuthButtons />
      </form>
    </Form>
  );
}
