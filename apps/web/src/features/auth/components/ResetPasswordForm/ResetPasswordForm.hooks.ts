import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { toast } from '@repo/ui/sonner';
import { resetPasswordSchema, type ResetPasswordInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { getAppErrorCode } from '@/lib/trpc-errors';
import { useAuthForm } from '@/features/auth/AuthForm.hooks';
import type { IResetPasswordFormView } from './ResetPasswordForm.types';
import { authStrings } from '@/features/auth/Auth.strings';

// The reset token is route state, not a prop: read it from the URL search here
// so the component never receives a secret as a prop (props-must-be-visual).
const routeApi = getRouteApi('/auth/reset-password');

// Delay before redirecting to login so the success toast is visible.
const REDIRECT_AFTER_RESET_MS = 1500;

export function useResetPasswordForm(): IResetPasswordFormView {
  // Optional in the route search (see routes/auth/reset-password.tsx); the
  // empty string is what the schema and the probe below both see when the link
  // arrived without one, and `isTokenMissing` is what the form renders instead.
  const { token = '' } = routeApi.useSearch();
  const navigate = useNavigate();
  const [showRequestNewLink, setShowRequestNewLink] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);

  const { form, serverError, setServerError, handleServerError } = useAuthForm<ResetPasswordInput>({
    schema: resetPasswordSchema,
    defaultValues: {
      token,
      password: '',
      factorCode: '',
    },
  });

  const password = form.watch('password');

  // Ask the server on load whether this reset needs a second-factor code, so a
  // 2FA-protected account sees the code field instead of hitting a dead-end
  // TWO_FACTOR_INVALID_CODE on submit. A mutation (not a query) keeps the token
  // in the request body rather than a cacheable GET URL.
  const tokenStateMutation = useMutation({
    ...trpc.auth.resetPasswordTokenState.mutationOptions(),
    onSuccess: (data) => {
      setRequiresTwoFactor(data.requiresTwoFactor);
    },
  });

  // Fire exactly once on mount, ref-guarded against StrictMode's double-invoke
  // (the probe is per-IP rate limited server-side).
  const probedRef = useRef(false);
  useEffect(() => {
    // No token means no reset to probe; firing anyway would spend one of the
    // per-IP rate-limit slots on a request that cannot succeed.
    if (probedRef.current || token === '') return;
    probedRef.current = true;
    tokenStateMutation.mutate({ token });
  }, [token, tokenStateMutation]);

  const resetPasswordMutation = useMutation({
    ...trpc.auth.resetPassword.mutationOptions(),
    onSuccess: () => {
      toast.success(authStrings.resetPassword.success);
      setTimeout(() => {
        void navigate({ to: '/auth/login' });
      }, REDIRECT_AFTER_RESET_MS);
    },
    onError: (error) => {
      const code = getAppErrorCode(error);
      if (code === AppErrorCode.INVALID_TOKEN || code === AppErrorCode.TOKEN_EXPIRED) {
        setServerError(authStrings.resetPassword.invalidLink);
        setShowRequestNewLink(true);
      } else if (code === AppErrorCode.TWO_FACTOR_INVALID_CODE) {
        // Reveal the field (in case the load probe raced or was skipped) and
        // mark the code wrong, matching the disable-dialog pattern.
        setRequiresTwoFactor(true);
        form.setError('factorCode', { message: authStrings.resetPassword.codeIncorrect });
      } else {
        handleServerError(error);
        setShowRequestNewLink(false);
      }
    },
  });

  function onSubmit(data: ResetPasswordInput) {
    setServerError(null);
    setShowRequestNewLink(false);
    resetPasswordMutation.mutate(data);
  }

  return {
    form,
    onSubmit,
    serverError,
    // isSuccess keeps the submit disabled during the delayed redirect to login.
    isPending: resetPasswordMutation.isPending || resetPasswordMutation.isSuccess,
    password,
    showRequestNewLink,
    requiresTwoFactor,
    // Somebody opened /auth/reset-password directly, or a mail client rewrote
    // the link without its query. Submitting would fail the schema on a field
    // they cannot see, so the form is not offered at all.
    isTokenMissing: token === '',
  };
}
