import { formatDate } from '@/lib/i18n/format';
import { useTwoFactorStatus } from '../../TwoFactor.queries';
import type { IGraceBannerView } from './GraceBanner.types';

/**
 * Show the enrollment nag only during the grace window: the tenant requires
 * 2FA, this user has no factor yet, and grace has NOT expired. Once
 * `policy.enforced` flips true the session is flagged and the middleware
 * allowlist redirects the user to the enroll-only screen, so the banner would
 * never render in that state anyway.
 *
 * The deadline is an instant, so `formatDate` (app locale, the reader's zone)
 * rather than the browser-locale `toLocaleDateString()`.
 */
export function useGraceBanner(): IGraceBannerView {
  const { data } = useTwoFactorStatus();
  const show = Boolean(data && data.policy.required && !data.enabled && !data.policy.enforced);
  const graceEndsAt = data?.policy.graceEndsAt ?? null;
  return { show, deadlineLabel: graceEndsAt ? formatDate(graceEndsAt) : null };
}
