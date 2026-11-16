import { useTranslation } from 'react-i18next';
import { AUTH_NS } from '@/features/auth/Auth.i18n';
import type { IBrandPanelView } from './BrandPanel.types';

/**
 * Placeholder brand copy for the auth screens, from the `auth` catalog. The
 * foot line states something the starter actually does rather than a customer
 * count it does not have.
 */
export function useBrandPanel(): IBrandPanelView {
  const { t } = useTranslation(AUTH_NS);
  return {
    headline: t('brandPanel.headline'),
    subheadline: t('brandPanel.subheadline'),
    trustCopy: t('brandPanel.trustCopy'),
  };
}
