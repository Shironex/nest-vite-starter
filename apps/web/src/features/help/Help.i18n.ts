import { registerFeatureNamespace } from '@/lib/i18n';
import en from './locales/en.json';

/**
 * Attach this feature's catalogs under the `help` namespace.
 *
 * Imported for side effect from the ENGINE as well as from the components,
 * which is stricter than the other features need to be: driver.js renders its
 * own DOM from config values rather than from JSX, so the copy has to be
 * resolved and handed over BEFORE the first step paints. A namespace that
 * registers when a component mounts would be too late for a tour started from
 * anywhere that is not that component.
 */
registerFeatureNamespace('help', { en });

/** The namespace name, so callers do not repeat the string literal. */
export const HELP_NS = 'help';
