import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { getInitials } from '@/lib/avatar';
import type { IProfileSectionView } from './ProfileSection.types';

export function useProfileSection(): IProfileSectionView | null {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user) return null;

  return {
    displayName: user.displayName ?? t('settings.profile.notSet'),
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    initials: getInitials(user.displayName, user.email),
  };
}
