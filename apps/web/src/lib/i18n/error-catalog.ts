import type { AppErrorCode } from '@repo/shared/errors';
import en from './locales/en.json';

/**
 * The `errors` namespace is keyed by `AppErrorCode` and nothing else: one
 * user-facing sentence per code the API can put on `error.data.appCode`.
 */
export type ErrorCatalog = Record<AppErrorCode, string>;

/**
 * Exhaustiveness gate. `satisfies` makes a missing or misspelled code a COMPILE
 * error rather than a silent untranslated key at runtime: adding a code to
 * `packages/shared/src/errors/codes.ts` without adding the sentence here fails
 * `pnpm --filter @repo/web check-types`.
 *
 * This is re-exported into the i18next resource bundle (see ./index.ts) so the
 * checked object is the one actually shipped, not a parallel copy. A second
 * language's `errors` object gets the same gate by being typed as
 * `ErrorCatalog` where it is attached.
 */
export const errorsEn = en.errors satisfies ErrorCatalog;
