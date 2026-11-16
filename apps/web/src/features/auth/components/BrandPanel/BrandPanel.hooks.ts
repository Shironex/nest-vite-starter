import type { IBrandPanelView } from './BrandPanel.types';
import { authStrings } from '@/features/auth/Auth.strings';

/**
 * Placeholder brand copy for the auth screens, from the `auth` catalog. The
 * foot line states something the starter actually does rather than a customer
 * count it does not have.
 */
export function useBrandPanel(): IBrandPanelView {
  return {
    headline: authStrings.brandPanel.headline,
    subheadline: authStrings.brandPanel.subheadline,
    trustCopy: authStrings.brandPanel.trustCopy,
  };
}
