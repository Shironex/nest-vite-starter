import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { useAuth } from '@/hooks/use-auth';
import { trpc, resetCsrfToken } from '@/lib/trpc';
import { getInitials } from '@/lib/avatar';
import type { IUserMenuView } from './UserMenu.types';
import { layoutStrings } from '@/features/layout/Layout.strings';

export function useUserMenu(): IUserMenuView | null {
  const { user } = useAuth();
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
      toast.error(layoutStrings.userMenu.logoutError);
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
      trigger: `${layoutStrings.userMenu.trigger}: ${displayName}`,
      settings: layoutStrings.userMenu.settings,
      logout: layoutStrings.userMenu.logout,
    },
    onLogout: () => logoutMutation.mutate(),
    onNavigateToSettings: () => void navigate({ to: '/settings' }),
  };
}
