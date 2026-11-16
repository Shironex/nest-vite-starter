import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getRouteApi } from '@tanstack/react-router';
import { resendVerificationSchema, type ResendVerificationInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { getAppErrorCode, translateAppError } from '@/lib/trpc-errors';
import { useAuthForm } from '@/features/auth/AuthForm.hooks';
import type { ICheckYourEmailView, IVerifyWithTokenView, VerifyStatus } from './VerifyEmail.types';

// The verification token is route state, not a prop: read it from the URL
// search here so the component never receives a secret as a prop.
const routeApi = getRouteApi('/auth/verify-email');

export function useVerifyEmail(): {
  readonly token: string | undefined;
  readonly emailSent: boolean | undefined;
} {
  const { token, emailSent } = routeApi.useSearch();
  return { token, emailSent };
}

// Mode 1: auto-verify exactly once when arriving from the email link.
export function useVerifyWithToken(token: string): IVerifyWithTokenView {
  const { t } = useTranslation();
  const [status, setStatus] = useState<VerifyStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Keyed by token (not a boolean) so a token change while mounted re-verifies,
  // while StrictMode's double effect run for the same token stays suppressed.
  const triggeredRef = useRef<string | null>(null);

  // `mutate` is referentially stable in TanStack Query, so listing it keeps
  // exhaustive-deps satisfied without retriggering the effect.
  const { mutate: verifyEmail } = useMutation({
    ...trpc.auth.verifyEmail.mutationOptions(),
    onSuccess: () => {
      setStatus('success');
    },
    onError: (error) => {
      setStatus('error');
      const code = getAppErrorCode(error);
      if (code === AppErrorCode.INVALID_TOKEN || code === AppErrorCode.TOKEN_EXPIRED) {
        setErrorMessage(t('auth.verifyEmail.invalidLink'));
      } else {
        setErrorMessage(translateAppError(error) ?? t('errors.unexpected'));
      }
    },
  });

  useEffect(() => {
    if (triggeredRef.current !== token) {
      triggeredRef.current = token;
      verifyEmail({ token });
    }
  }, [token, verifyEmail]);

  // Manual retry after a transient failure (network blip, 500): re-verify
  // the same token instead of leaving the user on a terminal error screen.
  const retry = useCallback(() => {
    setStatus('loading');
    setErrorMessage(null);
    verifyEmail({ token });
  }, [token, verifyEmail]);

  return { status, errorMessage, retry };
}

// Mode 2: "check your email" message with a resend option (no token present).
export function useCheckYourEmail(): ICheckYourEmailView {
  const [resendSuccess, setResendSuccess] = useState(false);

  const {
    form,
    serverError,
    setServerError,
    handleServerError,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  } = useAuthForm<ResendVerificationInput>({
    schema: resendVerificationSchema,
    // This form kept react-hook-form's default validation mode.
    mode: 'onSubmit',
    defaultValues: {
      turnstileToken: '',
    },
  });

  const resendMutation = useMutation({
    ...trpc.auth.resendVerification.mutationOptions(),
    onSuccess: () => {
      setResendSuccess(true);
      setServerError(null);
    },
    onError: handleServerError,
  });

  function onResend(data: ResendVerificationInput) {
    setServerError(null);
    setResendSuccess(false);
    resendMutation.mutate(data);
  }

  return {
    form,
    onResend,
    resendSuccess,
    serverError,
    isPending: resendMutation.isPending,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  };
}
