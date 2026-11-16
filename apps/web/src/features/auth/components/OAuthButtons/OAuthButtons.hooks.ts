import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getApiBaseUrl, IS_ELECTRON } from '@/lib/electron';
import { SMALL_FETCH_TIMEOUT_MS } from '@/lib/fetch-timeouts';
import {
  isOAuthProviderKey,
  oauthStartPath,
  OAUTH_PROVIDER_NAMES,
  OAUTH_PROVIDERS_PATH,
} from '@/features/auth/Auth.constants';
import type { OAuthProviderKey } from '@/features/auth/Auth.constants';
import type { IOAuthButtonsView, IOAuthProviderOption } from './OAuthButtons.types';

/** Shared by both auth forms, so the two mounts issue one discovery request. */
export const OAUTH_PROVIDERS_QUERY_KEY = ['oauth', 'providers'] as const;

/** Where a sign-in with no explicit target lands, matching useLoginForm. */
const DEFAULT_RETURN_TO = '/dashboard';

/**
 * The same open-redirect guard the `/auth/login` and `/auth/two-factor` routes
 * apply to their own `redirect` param: a legitimate target is origin-stripped
 * and starts with exactly one '/'. Repeated here rather than imported because
 * this value leaves the SPA as a query string on a cross-origin flow, and the
 * button must not depend on which route happens to be hosting it. The api
 * re-validates `returnTo` on its side; this is the client half of that pair.
 */
const safeReturnTo = (value: string | undefined): string =>
  value !== undefined &&
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !value.startsWith('/\\')
    ? value
    : DEFAULT_RETURN_TO;

/**
 * Runtime provider discovery: one build artifact per environment, so
 * which providers are enabled is a server answer rather than a VITE_ key baked
 * into the bundle.
 *
 * A failure resolves to "no providers" instead of rejecting. The whole surface
 * is optional chrome, and the only useful thing to show when the api cannot say
 * what is enabled is nothing. Rejecting would route through the global
 * QueryCache onError, which logs and reports to Sentry, for a state that blocks
 * nobody from signing in with a password.
 */
export async function fetchEnabledProviders(): Promise<OAuthProviderKey[]> {
  try {
    const response = await fetch(getApiBaseUrl() + OAUTH_PROVIDERS_PATH, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(SMALL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];

    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('providers' in body)) return [];

    const { providers } = body;
    if (!Array.isArray(providers)) return [];

    return providers.flatMap((entry: unknown) =>
      typeof entry === 'object' && entry !== null && 'key' in entry && isOAuthProviderKey(entry.key)
        ? [entry.key]
        : [],
    );
  } catch {
    return [];
  }
}

export function useOAuthButtons(): IOAuthButtonsView {
  const { t } = useTranslation();
  // `strict: false` because both auth forms render this and neither owns the
  // param; the same read useLoginForm does.
  const search = useSearch({ strict: false }) as { redirect?: string };

  const { data } = useQuery({
    queryKey: OAUTH_PROVIDERS_QUERY_KEY,
    queryFn: fetchEnabledProviders,
    // Which providers are enabled is deployment configuration, not session
    // state: fetch it once and let both forms share the cache entry.
    staleTime: Infinity,
    // v1 is web-only. A packaged shell would need the loopback flow,
    // which does not exist yet, so it must never even ask.
    enabled: !IS_ELECTRON,
  });

  const providers: IOAuthProviderOption[] = (data ?? []).map((key) => ({
    key,
    label: t('auth.oauthContinueWith', { provider: OAUTH_PROVIDER_NAMES[key] }),
  }));

  function onSelect(key: OAuthProviderKey) {
    window.location.assign(getApiBaseUrl() + oauthStartPath(key, safeReturnTo(search.redirect)));
  }

  return { providers, dividerLabel: t('auth.oauthDivider'), onSelect };
}
