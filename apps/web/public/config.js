// Runtime configuration, read by src/lib/env.ts before the app boots.
//
// This committed file holds the development defaults (all empty, which means:
// same-origin api, the always-pass Turnstile test widget, no error reporting,
// the built-in product name). In the web image the file is not served from here:
// the container writes a fresh one from its environment at start (see
// apps/web/docker/10-write-config.sh), so one image serves every environment.
window.__APP_CONFIG__ = {
  API_URL: '',
  TURNSTILE_SITE_KEY: '',
  SENTRY_DSN: '',
  APP_NAME: '',
};
