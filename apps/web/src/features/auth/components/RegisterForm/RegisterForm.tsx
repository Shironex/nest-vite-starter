import { Form } from '@repo/ui/form';
import { PasswordStrength } from '@/features/shared/components/PasswordStrength';
import { AuthField } from '@/features/auth/components/AuthField';
import { TurnstileField } from '@/features/auth/components/TurnstileField';
import { AuthSubmit } from '@/features/auth/components/AuthSubmit';
import { FormError } from '@/features/auth/components/FormError';
import { useRegisterForm } from './RegisterForm.hooks';
import { authStrings } from '@/features/auth/Auth.strings';

/**
 * The registration screen, restricted to the fields the register mutation
 * actually accepts. The design additionally shows a first/last name pair and a
 * terms checkbox; neither exists in `registerSchema`, so they are
 * left out rather than stubbed into inputs that go nowhere.
 */
export default function RegisterForm() {
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

        <AuthField
          form={form}
          name="email"
          required
          label={authStrings.register.workEmail}
          type="email"
          placeholder={authStrings.fields.emailPlaceholder}
          autoComplete="email"
        />

        <AuthField
          form={form}
          name="displayName"
          label={authStrings.register.displayName}
          placeholder={authStrings.register.displayNamePlaceholder}
          autoComplete="name"
        />

        <AuthField
          form={form}
          name="password"
          required
          label={authStrings.fields.password}
          type="password"
          placeholder={authStrings.fields.newPasswordPlaceholder}
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
          {authStrings.register.submit}
        </AuthSubmit>
      </form>
    </Form>
  );
}
