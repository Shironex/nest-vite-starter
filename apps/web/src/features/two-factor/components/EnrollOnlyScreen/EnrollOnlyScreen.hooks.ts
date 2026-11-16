import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc, resetCsrfToken } from '@/lib/trpc';
import type { IEnrollOnlyScreenView } from './EnrollOnlyScreen.types';

/**
 * Drives the enroll-only screen shown when a member's tenant now enforces 2FA
 * and their grace has expired: they can only enroll or sign out. `logout` is on
 * the middleware allowlist, so it works despite the enrollment-required flag.
 */
export function useEnrollOnlyScreen(): IEnrollOnlyScreenView {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    ...trpc.auth.logout.mutationOptions(),
    onSuccess: () => {
      resetCsrfToken();
      queryClient.clear();
      void navigate({ to: '/auth/login' });
    },
    onError: () => toast.error(t('twoFactor.enrollOnly.logoutFailed')),
  });

  function onEnrollComplete() {
    // activate re-issued the session without the enrollment-required flag, so
    // the authenticated area is reachable again.
    void queryClient.invalidateQueries(trpc.user.me.queryOptions());
    void navigate({ to: '/dashboard' });
  }

  return {
    onLogout: () => logoutMutation.mutate(),
    isLoggingOut: logoutMutation.isPending,
    onEnrollComplete,
  };
}
