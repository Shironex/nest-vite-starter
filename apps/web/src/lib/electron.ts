/**
 * Electron detection helpers and API URL resolution.
 *
 * In Electron mode the web renderer talks to an external NestJS API
 * at a configured URL. These helpers let tRPC resolve
 * the correct URL at runtime.
 */

export const IS_ELECTRON = typeof window !== 'undefined' && !!window.electronAPI;

let apiUrl: string | null = null;

/**
 * Fetch the API URL from the Electron main process.
 * Must be called once before any tRPC connections are made.
 * No-op in web mode.
 */
export async function initElectron(): Promise<void> {
  if (!IS_ELECTRON) return;
  const url = await window.electronAPI!.app.getApiUrl();
  if (url === null) {
    throw new Error('Electron main process rejected the API URL request.');
  }
  apiUrl = url;
}

/**
 * Returns the API base URL for non-tRPC API calls (e.g. CSRF token fetch).
 *
 * Empty string in web mode, and that is the intended value, not a missing one.
 * The browser is served from the same origin as the API, so every caller that
 * prefixes this produces a relative URL that resolves against the page origin.
 * Electron has no page origin to resolve against, which is the only reason the
 * absolute form exists.
 *
 * Keep it that way. The alternative, a configurable absolute origin in the
 * browser, buys nothing (the requests already go where they should) and adds
 * the one ingredient an SSRF needs: a prefix somebody can influence. The
 * `noctcore-security/no-user-controlled-fetch-url` rule treats
 * `getApiBaseUrl()` as a trusted origin (packages/eslint-config/base.js), so a
 * helper here that ever accepted a caller-supplied prefix would launder an
 * attacker-chosen URL through a name the lint has been told to trust. Anything
 * caller-supplied belongs behind `toApiPath`, which validates it as a
 * same-origin path first.
 */
export function getApiBaseUrl(): string {
  if (!IS_ELECTRON) return '';
  if (apiUrl === null) {
    throw new Error('API URL not initialized. Call initElectron() first.');
  }
  return apiUrl;
}

/**
 * Returns the tRPC URL. In Electron mode this is an absolute URL to
 * the external API; in web mode it's the relative `/trpc` (proxied by Vite).
 */
export function getTrpcUrl(): string {
  if (!IS_ELECTRON) return '/trpc';
  return `${getApiBaseUrl()}/trpc`;
}
