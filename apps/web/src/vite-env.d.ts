/// <reference types="vite/client" />

// This file is a module (it has an export), so the ImportMetaEnv augmentation
// must live in `declare global` to merge with vite/client's global interface.
export {};

declare global {
  interface ImportMetaEnv {
    /**
     * Sentry DSN for web error reporting (public value, error events only).
     * Empty or unset disables reporting entirely; the Electron renderer
     * ignores it (see src/lib/error-reporting.ts).
     */
    readonly VITE_SENTRY_DSN?: string;
    /**
     * Cloudflare Turnstile site key. Unset falls back to the always-pass
     * test key (UI fail-open; server-side verification stays the real gate).
     */
    readonly VITE_TURNSTILE_SITE_KEY?: string;
  }
}
