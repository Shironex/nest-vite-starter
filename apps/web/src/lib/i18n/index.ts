import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { ResourceKey } from 'i18next';
import { errorsEn } from './error-catalog';
import en from './locales/en.json';

/**
 * i18n bootstrap.
 *
 * The app ships in ONE language, English, and it is BUNDLED: it is what every
 * session renders, so fetching it would trade bytes for a flash of raw keys on
 * first paint. There is no language switcher and no stored language
 * preference.
 *
 * The engine is kept anyway, because it is what makes a second language a
 * small change rather than a rewrite: every user-visible string already lives
 * in a catalog (`no-hardcoded-ui-strings`), every static key is checked against
 * the English catalogs (`translation-key-exists`), and unused keys are flagged
 * (`translation-dead-keys`).
 *
 * Namespaces are per-feature. `common` and `errors` are the two shared ones and
 * live here; a feature ships `features/<domain>/locales/en.json` and registers
 * it with `registerFeatureNamespace` (see features/README.md). Shared keys never
 * live in a feature, so `no-cross-feature-imports` stays satisfied.
 *
 * ADDING A LANGUAGE. The steps, in order:
 *
 *   1. Add `locales/<lng>.json` next to every `locales/en.json` (the shared one
 *      here and one per feature), same key set.
 *   2. Widen `IFeatureCatalogs` with `readonly <lng>: () => Promise<{ default:
 *      ResourceKey }>` and pass `<lng>: () => import('./locales/<lng>.json')`
 *      from every `*.i18n.ts`. Keep it a dynamic `import()`: that is a
 *      build-time split point, so the new catalogs cost the entry graph nothing.
 *   3. Add a `loadLanguage(lng)` here that imports the shared and the
 *      registered feature catalogs and calls `i18n.addResourceBundle` for each,
 *      and have `registerFeatureNamespace` attach a late-registered namespace to
 *      any language already loaded (lazy routes register after start-up).
 *      Switch with `await loadLanguage(lng)` then `i18n.changeLanguage(lng)`,
 *      and set `document.documentElement.lang`.
 *   4. Pick the formatting locale per language (`APP_LOCALE` in
 *      `@repo/shared/constants` is the single default today).
 *
 * The type change in step 2 is deliberate: every registration stops compiling
 * until it supplies the new catalog, a type error rather than a screen of raw
 * keys.
 */

export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_NAMESPACE = 'common';

/** The namespaces bundled at startup. Feature namespaces are added as features load. */
export const SHARED_NAMESPACES = ['common', 'errors'] as const;

/**
 * A feature's catalogs, one per language. English is the only one today; see
 * "ADDING A LANGUAGE" above for how this widens.
 */
export interface IFeatureCatalogs {
  readonly en: ResourceKey;
}

const resources = {
  en: { common: en.common, errors: errorsEn },
};

let initPromise: Promise<void> | null = null;

/**
 * Idempotent: safe to call from `main.tsx` and the
 * vitest setup file without double-initialising the singleton.
 */
export function initI18n(): Promise<void> {
  initPromise ??= i18n
    .use(initReactI18next)
    .init({
      lng: DEFAULT_LANGUAGE,
      fallbackLng: DEFAULT_LANGUAGE,
      ns: SHARED_NAMESPACES,
      defaultNS: DEFAULT_NAMESPACE,
      resources,
      // React escapes everything it renders; letting i18next escape as well
      // would double-encode apostrophes and quotation marks.
      interpolation: { escapeValue: false },
      // A missing key returns the key (a string), never null, so callers never
      // have to widen their return types to `string | null`.
      returnNull: false,
      // The catalogs are bundled, so initialize synchronously: `i18n.t` is
      // usable the moment `initI18n()` has been called, which is what the
      // vitest setup file relies on.
      initAsync: false,
      // Re-render `useTranslation` consumers when a bundle is ADDED, not only
      // when the language changes. A lazily loaded route registers its
      // namespace after the first render, and a component already on screen
      // must pick it up.
      react: { bindI18nStore: 'added' },
    })
    .then(() => undefined);
  return initPromise;
}

/**
 * Attach a feature's catalogs under its own namespace. Call it once from the
 * feature (module scope is fine, init is synchronous).
 *
 * Initializing first is what MAKES module scope fine, and it is not optional.
 * i18next attaches `addResourceBundle` to the instance inside `init()`, so on an
 * uninitialized instance the method is simply absent. Feature catalogs are
 * imported through the route tree, which every entrypoint imports at module
 * scope, so they register BEFORE the entrypoint body gets to call `initI18n`,
 * and calling it here is the only ordering that holds for all of them.
 *
 * Safe to call on every registration: `initI18n` is idempotent, and `initAsync:
 * false` means the instance is fully built by the time it returns, promise or
 * not.
 */
export function registerFeatureNamespace(namespace: string, bundles: IFeatureCatalogs): void {
  void initI18n();
  i18n.addResourceBundle(DEFAULT_LANGUAGE, namespace, bundles.en, true, true);
}

// Re-exported so `@/lib/i18n` is the single import surface for translation and
// locale-aware formatting. `@/lib/i18n/format` stays importable on its own.
export {
  formatCalendarDate,
  formatCurrency,
  formatDate,
  formatNumber,
  fromDateInputValue,
  toDateInputValue,
} from './format';

export { i18n };
export default i18n;
