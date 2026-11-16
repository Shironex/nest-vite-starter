import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Switch } from '@repo/ui/switch';
import { Form, FormField, FormItem, FormLabel, FormControl } from '@repo/ui/form';
import { AUTH_LINK_CLASS } from '@/features/auth/Auth.constants';
import { AUTH_NS } from '@/features/auth/Auth.i18n';
import { AuthField } from '@/features/auth/components/AuthField';
import { TurnstileField } from '@/features/auth/components/TurnstileField';
import { AuthSubmit } from '@/features/auth/components/AuthSubmit';
import { FormError } from '@/features/auth/components/FormError';
import { OAuthButtons } from '@/features/auth/components/OAuthButtons';
import { OAuthErrorAlert } from '@/features/auth/components/OAuthErrorAlert';
import { useLoginForm } from './LoginForm.hooks';

/**
 * The sign-in screen, including the "Continue with Google" button the design
 * shows. It renders only when the api reports Google as enabled (configuring
 * the OAuth client is a deployment step, not a build-time one), so an environment
 * with no OAuth client configured still sees exactly the old screen.
 */
export default function LoginForm() {
  const { t } = useTranslation(AUTH_NS);
  const {
    form,
    onSubmit,
    serverError,
    isPending,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  } = useLoginForm();

  const forgotPasswordLink = (
    <Link to="/auth/forgot-password" className={`type-label-caption! ${AUTH_LINK_CLASS}`}>
      {t('login.forgotPassword')}
    </Link>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        {serverError && <FormError>{serverError}</FormError>}
        <OAuthErrorAlert />

        <AuthField
          form={form}
          name="email"
          required
          label={t('fields.email')}
          type="email"
          placeholder={t('fields.emailPlaceholder')}
          autoComplete="email"
        />

        <AuthField
          form={form}
          name="password"
          required
          label={t('fields.password')}
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          labelAction={forgotPasswordLink}
        />

        <FormField
          control={form.control}
          name="rememberMe"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-2.5">
              <FormControl>
                <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="mt-0! cursor-pointer type-body-small text-text-secondary">
                {t('login.rememberMe')}
              </FormLabel>
            </FormItem>
          )}
        />

        <TurnstileField
          form={form}
          turnstileRef={turnstileRef}
          onStatusChange={onCaptchaStatusChange}
        />

        <AuthSubmit isPending={isPending} captchaStatus={captchaStatus}>
          {t('login.submit')}
        </AuthSubmit>

        <OAuthButtons />
      </form>
    </Form>
  );
}
