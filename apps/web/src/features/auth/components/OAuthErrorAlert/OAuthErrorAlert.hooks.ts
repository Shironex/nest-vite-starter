import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isOAuthErrorCode } from '@/features/auth/Auth.constants';
import type { OAuthErrorCode } from '@/features/auth/Auth.constants';
import type { IOAuthErrorAlertView } from './OAuthErrorAlert.types';

/**
 * The copy map, SPEC section 9 item 3. A `Record<OAuthErrorCode, string>` so
 * adding a code to `OAUTH_ERROR_CODES` without shipping a sentence for it is a
 * compile error, the same gate `lib/i18n/error-catalog.ts` puts on AppErrorCode.
 *
 * The keys point into the `common` namespace under `auth.oauthErrors`, NOT into
 * the `errors` namespace: `errors` is keyed by AppErrorCode and nothing else,
 * and these five are URL query values that never ride on a tRPC error.
 */
export const OAUTH_ERROR_MESSAGE_KEYS: Record<OAuthErrorCode, string> = {
  oauth_failed: 'auth.oauthErrors.oauth_failed',
  oauth_state_expired: 'auth.oauthErrors.oauth_state_expired',
  oauth_account_exists: 'auth.oauthErrors.oauth_account_exists',
  oauth_link_blocked: 'auth.oauthErrors.oauth_link_blocked',
  oauth_signup_disabled: 'auth.oauthErrors.oauth_signup_disabled',
};

export function useOAuthErrorAlert(): IOAuthErrorAlertView {
  const { t } = useTranslation();
  // `strict: false` because both auth forms render this: the param is validated
  // once on the `/auth` layout route and inherited by every screen under it.
  const search = useSearch({ strict: false }) as { error?: string };
  const code = search.error;

  return {
    message: isOAuthErrorCode(code) ? t(OAUTH_ERROR_MESSAGE_KEYS[code]) : null,
  };
}
