import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { useAuth } from '@/hooks/use-auth';
import { trpc, resetCsrfToken } from '@/lib/trpc';
import { getInitials } from '@/lib/avatar';
import type { IUserMenuView } from './UserMenu.types';

export function useUserMenu(): IUserMenuView | null {
  const { user } = useAuth();
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
    onError: () => {
      toast.error(t('userMenu.logoutError'));
    },
  });

  if (!user) return null;

  const displayName = user.displayName ?? user.email;

  return {
    displayName,
    email: user.email,
    initials: getInitials(user.displayName, user.email),
    isLogoutPending: logoutMutation.isPending,
    labels: {
      // The trigger is icon-only, so the name carries into its accessible name.
      trigger: `${t('userMenu.trigger')}: ${displayName}`,
      settings: t('userMenu.settings'),
      logout: t('userMenu.logout'),
    },
    onLogout: () => logoutMutation.mutate(),
    onNavigateToSettings: () => void navigate({ to: '/settings' }),
  };
}
