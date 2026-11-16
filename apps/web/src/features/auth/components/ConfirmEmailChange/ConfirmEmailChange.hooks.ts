import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { getAppErrorCode, translateAppError } from '@/lib/trpc-errors';
import type { ConfirmEmailChangeStatus, IConfirmEmailChangeView } from './ConfirmEmailChange.types';

/**
 * Auto-confirm exactly once when arriving from the email link, the
 * useVerifyWithToken shape: keyed by token so a token change re-confirms
 * while StrictMode's double effect run stays suppressed. On success the api
 * has already revoked every session (the login identity changed), so the
 * success state routes to sign-in rather than back into the app.
 */
export function useConfirmEmailChange(token: string): IConfirmEmailChangeView {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ConfirmEmailChangeStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const triggeredRef = useRef<string | null>(null);

  const { mutate: confirmEmailChange } = useMutation({
    ...trpc.auth.confirmEmailChange.mutationOptions(),
    onSuccess: () => {
      setStatus('success');
    },
    onError: (error) => {
      setStatus('error');
      const code = getAppErrorCode(error);
      if (code === AppErrorCode.INVALID_TOKEN || code === AppErrorCode.TOKEN_EXPIRED) {
        // A consumed, expired or replaced link cannot be retried: the fix is
        // a fresh request from settings, which the copy says.
        setErrorMessage(t('auth.emailChange.confirm.invalidLink'));
      } else if (code === AppErrorCode.EMAIL_IN_USE) {
        setErrorMessage(t('auth.emailChange.confirm.emailInUse'));
      } else {
        setErrorMessage(translateAppError(error) ?? t('errors.unexpected'));
      }
    },
  });

  useEffect(() => {
    if (triggeredRef.current !== token) {
      triggeredRef.current = token;
      confirmEmailChange({ token });
    }
  }, [token, confirmEmailChange]);

  // Manual retry after a transient failure (network blip, 500). A burnt token
  // answers INVALID_TOKEN, which the error copy already routes to settings.
  const retry = useCallback(() => {
    setStatus('loading');
    setErrorMessage(null);
    confirmEmailChange({ token });
  }, [token, confirmEmailChange]);

  return { status, errorMessage, retry };
}
