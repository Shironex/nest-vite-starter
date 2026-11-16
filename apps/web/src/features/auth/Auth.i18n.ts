import { registerFeatureNamespace } from '@/lib/i18n';
import en from './locales/en.json';

/**
 * Attach this feature's catalogs under the `auth` namespace: the copy of the
 * sign-in, registration, password-reset and verify-email screens, and of the
 * brand panel beside them.
 *
 * Imported for side effect from the components that render the copy, never
 * from a route (`route-i18n-side-effect`). The older `auth.*` keys in the shared
 * `common` catalog stay where they are: the route files that title these screens read `common` because a route cannot
 * register this namespace itself.
 */
registerFeatureNamespace('auth', { en });

/** The namespace name, so callers do not repeat the string literal. */
export const AUTH_NS = 'auth';
