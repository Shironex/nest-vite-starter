import { registerFeatureNamespace } from '@/lib/i18n';
import en from './locales/en.json';

/**
 * Attach this feature's catalogs under the `audit` namespace.
 *
 * Imported for side effect from the feature's entry components, not from a
 * route: i18next init is synchronous, and registering at module scope means the
 * copy is present before the first render regardless of which screen the user
 * lands on.
 */
registerFeatureNamespace('audit', { en });

/** The namespace name, so callers do not repeat the string literal. */
export const AUDIT_NS = 'audit';
