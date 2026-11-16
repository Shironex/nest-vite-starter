import { useAuth } from '@/hooks/use-auth';
import { getInitials } from '@/lib/avatar';
import type { IProfileSectionView } from './ProfileSection.types';
import { settingsStrings } from '@/features/settings/Settings.strings';

export function useProfileSection(): IProfileSectionView | null {
  const { user } = useAuth();

  if (!user) return null;

  return {
    displayName: user.displayName ?? settingsStrings.profile.notSet,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    initials: getInitials(user.displayName, user.email),
  };
}
