import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { loginSchema } from '@repo/shared/schemas';
import type { LoginInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc, resetCsrfToken } from '@/lib/trpc';
import { STAFF_HOME_PATH } from '@/lib/shell-routes';
import { useAuthForm } from '@/features/auth/AuthForm.hooks';
import type { ILoginFormView } from './LoginForm.types';
import { authStrings } from '@/features/auth/Auth.strings';

export function useLoginForm(): ILoginFormView {
  const loginErrorMessages = {
    [AppErrorCode.ACCOUNT_LOCKED]: authStrings.login.accountLocked,
    [AppErrorCode.TURNSTILE_FAILED]: authStrings.login.captchaFailed,
  };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as { redirect?: string };

  const {
    form,
    serverError,
    setServerError,
    handleServerError,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  } = useAuthForm<LoginInput>({
    schema: loginSchema,
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
      turnstileToken: '',
    },
    errorMessages: loginErrorMessages,
  });

  const loginMutation = useMutation({
    ...trpc.auth.login.mutationOptions(),
    onSuccess: (data) => {
      if (data.status === 'twofa_required') {
        // Password verified, second factor required. The __Host-2fa pending
        // cookie is already set; the challenge page calls auth.verifyTwoFactor.
        void navigate({
          to: '/auth/two-factor',
          search: search.redirect !== undefined ? { redirect: search.redirect } : {},
        });
        return;
      }
      resetCsrfToken();
      void queryClient.invalidateQueries(trpc.user.me.queryOptions());
      // An explicit `redirect` wins: it came from the guard that bounced the
      // visitor here. The starter has one shell, so everybody else lands home.
      void navigate({ to: search.redirect ?? STAFF_HOME_PATH });
    },
    onError: handleServerError,
  });

  function onSubmit(data: LoginInput) {
    setServerError(null);
    loginMutation.mutate(data);
  }

  return {
    form,
    onSubmit,
    serverError,
    // isSuccess keeps the submit disabled while the async navigate completes.
    isPending: loginMutation.isPending || loginMutation.isSuccess,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  };
}
