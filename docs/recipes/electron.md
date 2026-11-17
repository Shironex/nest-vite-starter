# Recipe: an Electron desktop shell

**When you need it:** the same product as a desktop app, with the web app as its UI. The starter
is a web app only and ships no desktop code.

## Shape of the change

- **A new app.** Add `apps/desktop` (main process, preload, and a renderer that loads the built
  `apps/web` output or the dev server). Add the workspace entry, turbo tasks, a commit scope and
  a CI job, and keep desktop dependencies out of the web and api packages.
- **Where the api lives.** The desktop app talks to a deployed api over HTTPS, as the browser does.
  Set `API_URL` through the web runtime config so the renderer calls the right origin, and add that
  origin to the CORS list.
- **Cookies and CSRF.** A `file://` renderer is a different site from the api, so the
  `SameSite=Lax` session cookie will not be sent. Serve the renderer from a custom protocol on a
  stable origin (or from the deployed web origin) and treat that origin like any other:
  `CORS_ORIGINS`, CSRF, and a CSP that allows it. Do not weaken the cookie settings for
  everyone to make the desktop work.
- **Security defaults.** `contextIsolation` on, `nodeIntegration` off, a minimal preload API with
  validated IPC, `sandbox` on, a strict CSP, and navigation and `window.open` blocked except to
  allowed origins.
- **Packaging.** Signing and notarisation, an auto-update channel, and native modules rebuilt for
  Electron are each a project of their own. Budget for them.

## Pitfalls

- The renderer is your web app: anything it shows must still be authorised by the api, never by the
  shell.
- Auto-update without signature checks is a remote code execution channel.
- Do not store the session token in the main process or on disk. Let the cookie jar hold it.
