import { AppErrorCode } from '@repo/shared/errors';
import { i18n } from './i18n';

const APP_ERROR_CODES = new Set<string>(Object.values(AppErrorCode));

/**
 * Read the canonical AppErrorCode off a tRPC client error.
 *
 * The api's errorFormatter (apps/api/src/trpc/trpc.error-handler.ts) puts the
 * structured code on `error.data.appCode`; this is the single client-side
 * accessor so hooks match on codes instead of substring-matching messages.
 * Duck-typed (not `instanceof TRPCClientError`) so it stays robust across
 * mocked errors in tests and any duplicate @trpc/client instances.
 */
export function getAppErrorCode(error: unknown): AppErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return undefined;
  const appCode = (data as { appCode?: unknown }).appCode;
  return typeof appCode === 'string' && APP_ERROR_CODES.has(appCode)
    ? (appCode as AppErrorCode)
    : undefined;
}

/**
 * True when the error carries a `data` object, i.e. it is a real tRPC error
 * RESPONSE rather than a transport failure.
 *
 * `TRPCClientError.data` is copied from `result.error.data` and stays
 * `undefined` for anything the client never got a JSON body for.
 */
function hasErrorResponseData(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const data = (error as { data?: unknown }).data;
  return typeof data === 'object' && data !== null;
}

/**
 * Duck-typed `instanceof TRPCClientError`, matching this file's policy of not
 * importing the class (mocked errors in tests, duplicate @trpc/client copies).
 * The constructor sets `name = 'TRPCClientError'` on every instance.
 */
function isTrpcClientError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'TRPCClientError'
  );
}

/** Duck-typed message read: works for `Error`, `TRPCClientError`, and mocks. */
function readErrorMessage(error: unknown): string | undefined {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? (error as { message?: unknown }).message
        : undefined;
  return typeof message === 'string' && message !== '' ? message : undefined;
}

/**
 * Turn a tRPC client error into a user-facing sentence in the active language.
 *
 * Uses the standalone `i18n.t`, not `useTranslation()`, because the first
 * consumer is `queryCache.onError` in ./trpc.ts: that callback runs outside
 * React and cannot call hooks. Inside components prefer `useTranslation()` so
 * the copy re-renders on a language switch.
 *
 * Fallback contract, in order:
 *
 * 1. a mapped `appCode` wins, translated from the exhaustive catalog;
 * 2. an error that carries `data` (a real tRPC error RESPONSE) but no mapped
 *    code falls back to `error.message`, which on that path is the api's own
 *    sentence for the failure;
 * 3. a `TRPCClientError` with no `data` never reached the api at all, so it
 *    gets the network sentence rather than the browser's internals;
 * 4. anything else returns `undefined` so the caller picks its own copy.
 *
 * Rule 3 and 4 replace an older "always fall back to `error.message`" rule.
 * The api's errorFormatter stamps `appCode` on EVERY tRPC error response, so
 * the raw message only ever surfaced for transport failures, which means
 * every `translateAppError(e) ?? t('errors.unexpected')` site in the app was
 * showing "Failed to fetch" / "Unexpected token '<'" on a network blip and
 * the translated fallback beside it was dead code.
 */
export function translateAppError(error: unknown): string | undefined {
  const code = getAppErrorCode(error);
  // `i18n.t` before init would return the bare key, which is worse copy than
  // the server's own message.
  if (code !== undefined && i18n.isInitialized) {
    // The `errors` namespace is flat and keyed by AppErrorCode; the catalog is
    // exhaustiveness-checked at compile time in ./i18n/error-catalog.ts.
    const translated = i18n.t(`errors:${code}`, { defaultValue: '' });
    if (translated !== '') return translated;
  }

  if (hasErrorResponseData(error)) return readErrorMessage(error);

  if (isTrpcClientError(error) && i18n.isInitialized) {
    const network = i18n.t('common:errors.network', { defaultValue: '' });
    if (network !== '') return network;
  }

  return undefined;
}
