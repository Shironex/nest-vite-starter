import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { registerSchema } from '@repo/shared/schemas';
import type { RegisterInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc, resetCsrfToken } from '@/lib/trpc';
import { getAppErrorCode } from '@/lib/trpc-errors';
import { useAuthForm } from '@/features/auth/AuthForm.hooks';
import type { IRegisterFormView } from './RegisterForm.types';

export function useRegisterForm(): IRegisterFormView {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const {
    form,
    serverError,
    setServerError,
    handleServerError,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  } = useAuthForm<RegisterInput>({
    schema: registerSchema,
    defaultValues: {
      email: '',
      displayName: '',
      password: '',
      turnstileToken: '',
    },
  });

  const password = form.watch('password');

  const registerMutation = useMutation({
    ...trpc.auth.register.mutationOptions(),
    onSuccess: (data) => {
      resetCsrfToken();
      // The api reports emailSent: false when the verification mail could not
      // be enqueued; forward it so the verify-email screen points at resend
      // instead of claiming an email is on its way. Typed by the register
      // procedure's output schema: no cast needed.
      void navigate({
        to: '/auth/verify-email',
        search: data.emailSent ? {} : { emailSent: false },
      });
    },
    onError: (error) => {
      // EMAIL_IN_USE belongs on the email field, not the form-level banner.
      if (getAppErrorCode(error) === AppErrorCode.EMAIL_IN_USE) {
        form.setError('email', {
          message: t('auth.register.emailExists'),
        });
      } else {
        handleServerError(error);
      }
    },
  });

  function onSubmit(data: RegisterInput) {
    setServerError(null);
    registerMutation.mutate(data);
  }

  return {
    form,
    onSubmit,
    serverError,
    // isSuccess keeps the submit disabled while the async navigate completes.
    isPending: registerMutation.isPending || registerMutation.isSuccess,
    password,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  };
}
