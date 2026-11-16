import { Link } from '@tanstack/react-router';
import { Switch } from '@repo/ui/switch';
import { Form, FormField, FormItem, FormLabel, FormControl } from '@repo/ui/form';
import { AUTH_LINK_CLASS } from '@/features/auth/Auth.constants';
import { AuthField } from '@/features/auth/components/AuthField';
import { TurnstileField } from '@/features/auth/components/TurnstileField';
import { AuthSubmit } from '@/features/auth/components/AuthSubmit';
import { FormError } from '@/features/auth/components/FormError';
import { useLoginForm } from './LoginForm.hooks';
import { authStrings } from '@/features/auth/Auth.strings';

/** The sign-in screen: email and password, with an optional remember-me. */
export default function LoginForm() {
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
      {authStrings.login.forgotPassword}
    </Link>
  );

  return (
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

        <AuthField
          form={form}
          name="password"
          required
          label={authStrings.fields.password}
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
                {authStrings.login.rememberMe}
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
          {authStrings.login.submit}
        </AuthSubmit>
      </form>
    </Form>
  );
}
