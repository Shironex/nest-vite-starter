/*
 * Every `VITE_*` build-time value the web app reads, with its default.
 *
 * One module, because an env key read in two places grows two defaults and two
 * "is it set" tests, and the day they disagree is the day a production build
 * quietly behaves like a development one. `env-no-direct-import-meta-env` is
 * what keeps the next reader here.
 *
 * `import.meta.env.DEV`, `.PROD` and `.MODE` deliberately do NOT live here.
 * Vite substitutes those three literally at build time and the bundler's
 * dead-code elimination depends on seeing them at the branch: routed through a
 * module they become ordinary imports, the branch stays live, and every
 * development-only block ships to users.
 *
 * A key added here also needs its type in `src/vite-env.d.ts` and its seed
 * value in `.env.example`.
 */

/**
 * Cloudflare Turnstile site key.
 *
 * Empty means the deployment configured none: `TurnstileField` renders the
 * always-pass test widget so auth stays usable, and server-side verification
 * remains the real gate.
 */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

/**
 * Sentry DSN for web error reporting (a public value, error events only).
 *
 * Empty disables reporting entirely. The Electron renderer ignores it either
 * way, because its CSP blocks the ingest endpoint.
 */
export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN ?? '';
