import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { forgotPasswordSchema } from '@repo/shared/schemas';
import type { ForgotPasswordInput } from '@repo/shared/schemas';
import { trpc } from '@/lib/trpc';
import { useAuthForm } from '@/features/auth/AuthForm.hooks';
import type { IForgotPasswordFormView } from './ForgotPasswordForm.types';

export function useForgotPasswordForm(): IForgotPasswordFormView {
  const [submitted, setSubmitted] = useState(false);
  // The confirmation block replaces the form on submit: move focus to it so
  // keyboard/screen-reader users are not left on a removed element.
  const confirmationRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (submitted) {
      confirmationRef.current?.focus();
    }
  }, [submitted]);

  const {
    form,
    serverError,
    setServerError,
    handleServerError,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  } = useAuthForm<ForgotPasswordInput>({
    schema: forgotPasswordSchema,
    defaultValues: {
      email: '',
      turnstileToken: '',
    },
  });

  const forgotPasswordMutation = useMutation({
    ...trpc.auth.forgotPassword.mutationOptions(),
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: handleServerError,
  });

  function onSubmit(data: ForgotPasswordInput) {
    setServerError(null);
    forgotPasswordMutation.mutate(data);
  }

  return {
    form,
    onSubmit,
    submitted,
    serverError,
    isPending: forgotPasswordMutation.isPending,
    confirmationRef,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  };
}
