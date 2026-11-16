import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@repo/ui/sonner';
import { verifyTwoFactorSchema, type VerifyTwoFactorInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc, resetCsrfToken } from '@/lib/trpc';
import { getAppErrorCode } from '@/lib/trpc-errors';
import { STAFF_HOME_PATH } from '@/lib/shell-routes';
import type { ITwoFactorChallengeView } from './TwoFactorChallenge.types';

// The redirect target is route state, read here so the component never takes it
// as a prop. The `__Host-2fa` pending cookie is already set (by login or the
// Google callback), so this page needs no other params.
const routeApi = getRouteApi('/auth/two-factor');

export function useTwoFactorChallenge(): ITwoFactorChallengeView {
  const { t } = useTranslation();
  const { redirect } = routeApi.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<VerifyTwoFactorInput>({
    resolver: zodResolver(verifyTwoFactorSchema) as Resolver<VerifyTwoFactorInput>,
    mode: 'onBlur',
    defaultValues: { code: '', trustDevice: false },
  });

  const verifyMutation = useMutation({
    ...trpc.auth.verifyTwoFactor.mutationOptions(),
    onSuccess: (data) => {
      if (data.status !== 'ok') return;
      // Session was re-issued server-side; drop the pre-2fa CSRF token and
      // refetch the now-authenticated user before landing on the app.
      resetCsrfToken();
      void queryClient.invalidateQueries(trpc.user.me.queryOptions());
      // Same rule as LoginForm: an explicit redirect wins, otherwise home.
      void navigate({ to: redirect ?? STAFF_HOME_PATH });
    },
    onError: (error) => {
      const code = getAppErrorCode(error);
      // Expiry or attempt-exhaustion both arrive as CHALLENGE_EXPIRED (the
      // pending record is gone); restart from the password step.
      if (code === AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED) {
        toast.error(t('twoFactor.challenge.sessionExpired'));
        void navigate({ to: '/auth/login' });
        return;
      }
      setServerError(t('twoFactor.challenge.codeIncorrect'));
    },
  });

  function onSubmit(data: VerifyTwoFactorInput) {
    setServerError(null);
    verifyMutation.mutate(data);
  }

  function onToggleRecoveryMode() {
    setServerError(null);
    // `resetField` (not `setValue`) so the previous mode's validation error and
    // touched state go with the value: a "Code is required" left over from the
    // TOTP field is meaningless against a backup code, and clearing it keeps the
    // message row from lingering under the new field.
    form.resetField('code');
    setIsRecoveryMode((prev) => !prev);
  }

  return {
    form,
    onSubmit,
    serverError,
    // Keep the button disabled through the post-success navigation.
    isPending: verifyMutation.isPending || verifyMutation.isSuccess,
    isRecoveryMode,
    onToggleRecoveryMode,
  };
}
