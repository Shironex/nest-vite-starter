import { registerFeatureNamespace } from '@/lib/i18n';
import en from './locales/en.json';

/**
 * Attach this feature's catalogs under the `workspace` namespace.
 *
 * Imported for side effect from the feature's entry components, not from a
 * route: i18next init is synchronous, and registering at module scope means the
 * copy is present before the first render regardless of which screen the user
 * lands on. The picker renders on screens of four other features, and each of
 * them gets this catalog through the picker's own import, not through theirs.
 */
registerFeatureNamespace('workspace', { en });

/** The namespace name, so callers do not repeat the string literal. */
export const WORKSPACE_NS = 'workspace';
