/*
 * Every runtime value the web app reads, with its default.
 *
 * The values come from `window.__APP_CONFIG__`, which `/config.js` assigns before the app
 * boots. In the web image the container writes that file from its environment at start, so
 * one image serves every environment and nothing is baked in at build time. In development
 * the committed `public/config.js` supplies the (empty) defaults.
 *
 * One module, because a key read in two places grows two defaults and two "is it set"
 * tests, and the day they disagree is the day a production build quietly behaves like a
 * development one. `env-no-direct-import-meta-env` keeps the next reader here.
 *
 * `import.meta.env.DEV`, `.PROD` and `.MODE` deliberately do NOT live here. Vite substitutes
 * those three literally at build time and the bundler's dead-code elimination depends on
 * seeing them at the branch: routed through a module they become ordinary imports, the
 * branch stays live, and every development-only block ships to users.
 *
 * A key added here also needs its line in `public/config.js` and its handling in
 * `docker/10-write-config.sh`.
 */
import { PRODUCT_NAME } from '@repo/shared/constants';

/** The shape of `window.__APP_CONFIG__`: every key a string, empty meaning "not configured". */
export interface IAppConfig {
  API_URL: string;
  TURNSTILE_SITE_KEY: string;
  SENTRY_DSN: string;
  APP_NAME: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: unknown;
  }
}

/** Reads one key, accepting only a string: a missing file or a wrong type reads as unset. */
function readKey(source: unknown, key: keyof IAppConfig): string {
  if (typeof source !== 'object' || source === null) return '';
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Parses the config object `/config.js` assigned (exported for the unit test). */
export function parseAppConfig(source: unknown): IAppConfig {
  return {
    // A trailing slash would double up in `${API_URL}/trpc`.
    API_URL: readKey(source, 'API_URL').replace(/\/+$/, ''),
    TURNSTILE_SITE_KEY: readKey(source, 'TURNSTILE_SITE_KEY'),
    SENTRY_DSN: readKey(source, 'SENTRY_DSN'),
    APP_NAME: readKey(source, 'APP_NAME'),
  };
}

const config = parseAppConfig(typeof window === 'undefined' ? undefined : window.__APP_CONFIG__);

/**
 * Origin of the api when it is not served from the web's own origin. Empty means
 * same-origin: the web server (or the dev server's proxy) forwards `/trpc` and `/api`.
 */
export const API_URL = config.API_URL;

/** `path` (starting with `/`) resolved against the api: relative when API_URL is empty. */
export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

/** Credentials mode for api calls: cookies travel cross-origin only when an API_URL is set. */
export const API_CREDENTIALS: RequestCredentials = API_URL ? 'include' : 'same-origin';

/**
 * Cloudflare Turnstile site key.
 *
 * Empty means the deployment configured none: `TurnstileField` renders the
 * always-pass test widget so auth stays usable, and server-side verification
 * remains the real gate.
 */
export const TURNSTILE_SITE_KEY = config.TURNSTILE_SITE_KEY;

/**
 * Sentry DSN for web error reporting (a public value, error events only).
 *
 * Empty disables reporting entirely.
 */
export const SENTRY_DSN = config.SENTRY_DSN;

/** The product name shown in the UI and the tab title; the built-in name when unset. */
export const APP_NAME = config.APP_NAME || PRODUCT_NAME;
