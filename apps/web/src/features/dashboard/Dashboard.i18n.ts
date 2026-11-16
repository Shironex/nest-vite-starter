import { registerFeatureNamespace } from '@/lib/i18n';
import en from './locales/en.json';

/**
 * Attach this feature's catalogs under the `dashboard` namespace.
 *
 * Imported for side effect from the feature's entry components, not from a
 * route: i18next init is synchronous, and registering at module scope means the
 * copy is present before the first render regardless of which screen the user
 * lands on. The same import is repeated in the components themselves because a
 * component test mocks the hook module away, and without it the shell would
 * render bare i18n keys under test.
 */
registerFeatureNamespace('dashboard', { en });

/** The namespace name, so callers do not repeat the string literal. */
export const DASHBOARD_NS = 'dashboard';
