---
title: Google OAuth Deployment
description: Runbook for deploying Google sign-in - provisioning the per-environment Google clients, setting API_PUBLIC_URL and the OAUTH_GOOGLE_* pair on the api service, the exact-match redirect URI, and troubleshooting.
sidebar:
  order: 9
---

Runbook for turning on [Google sign-in](/backend/google-sign-in/) in a deployed environment. The feature is designed so that an environment without credentials keeps working: the provider registers as disabled, the API boots, the button never renders. Turning it on is pure configuration - no build or code change per environment.

## The environment variables

All on the **api** service, validated by Joi at boot (`apps/api/src/config/configuration.config.ts`), documented in the root `.env.example`:

| Var                          | Required?                                   | Default                            | Notes                                                          |
| ---------------------------- | ------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `API_PUBLIC_URL`             | **yes in production**                       | `http://localhost:3000` (dev/test) | The API's own public origin; sole source of the `redirect_uri` |
| `OAUTH_GOOGLE_CLIENT_ID`     | no - but only ever together with the secret | empty (provider disabled)          | From the Google console, per environment                       |
| `OAUTH_GOOGLE_CLIENT_SECRET` | no - but only ever together with the id     | empty (provider disabled)          | From the Google console, per environment                       |
| `OAUTH_ALLOW_SIGNUP`         | no                                          | `true`                             | `false` restricts Google sign-in to already-linked accounts    |

### `API_PUBLIC_URL`

The API's **own** public origin - distinct from `APP_URL`, which is the SPA's. It is the **sole source of the OAuth `redirect_uri`**, which is deliberately never derived from the request Host header (a forged Host must not be able to steer an authorization code to another origin).

- Set it to the api service's public **https** URL as routed by the proxy (e.g. `https://api.example.com`) - **not** an internal service URL like `http://api:3000`. Google redirects the **user's browser** to it; an internal hostname is unreachable from a browser.
- Required when `NODE_ENV=production` - the boot fails rather than silently minting `localhost` redirect URIs no console entry matches.
- Only the **origin** is used; a path suffix on the value is ignored.

### `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET`

Strictly **both-or-neither**, enforced by Joi at the schema level:

- **Both set:** the provider is enabled - it appears in `GET /api/auth/oauth/providers`, the web button renders, the flow routes work.
- **Both empty or absent:** the provider is disabled. The API boots normally, discovery omits Google, and `/api/auth/oauth/google/start` and `/callback` return 404. This is a legal, supported deployment.
- **Only one of the pair:** a **deliberate boot failure**. A half-configured client is never valid, and failing loudly at startup beats a flow that breaks at the callback in front of a user. If the api service crash-loops right after you edited these vars, this is the first thing to check.

### `OAUTH_ALLOW_SIGNUP`

Default `true`: a Google identity with no matching account provisions a fresh Organization plus admin user, exactly like password self-signup. Set to `false` for closed deployments; unmatched identities are then rejected with `oauth_signup_disabled`, while sign-in for accounts that already exist (linked, or auto-linkable) is unaffected.

## The redirect URI

The redirect URI is **derived, never configured**:

```
${API_PUBLIC_URL}/api/auth/oauth/google/callback
```

The `/api` prefix is load bearing. The SPA reaches the API same-origin, and the
platform router in front of the web container only forwards `/trpc`, `/api` and
`/socket.io` to the API service (`apps/web/nginx.conf` header comment,
`apps/web/vite.config.ts` `apiProxy`). A controller outside those three prefixes
is answered by the SPA's `index.html`, so discovery would parse HTML as JSON and
the Google button would never render in a browser deployment.

Google matches it **exactly** - byte for byte: scheme, host, port, path, **no trailing slash**. Because of that, every environment needs its **own** Google client with its own registered URI:

| Environment | `API_PUBLIC_URL`                  | Registered redirect URI                                          |
| ----------- | --------------------------------- | ---------------------------------------------------------------- |
| dev         | `http://localhost:3000`           | `http://localhost:3000/api/auth/oauth/google/callback`           |
| staging     | `https://api-staging.example.com` | `https://api-staging.example.com/api/auth/oauth/google/callback` |
| prod        | `https://api.example.com`         | `https://api.example.com/api/auth/oauth/google/callback`         |

One client id/secret pair per row, each registered with exactly one URI. Reusing the prod client for staging does not work (the staging callback URI would not match), and adding both URIs to one client is deliberately avoided: separate clients mean a leaked staging secret cannot be used against prod.

## Provisioning the Google clients

1. One Google Cloud project holds all three clients (per-environment **projects** are not needed).
2. **OAuth consent screen:** user type External, production publishing status (testing mode caps sign-ins at 100 hand-listed users and expires their grants after 7 days). Scopes: only `openid`, `userinfo.email`, `userinfo.profile` - all non-sensitive, so **no Google verification review is required**.
3. **Credentials > Create credentials > OAuth client ID**, type **Web application**, three clients (`api-dev`, `api-staging`, `api-prod`), each with its exact redirect URI from the table above. No "Authorized JavaScript origins" are needed - this is a server-side code flow; the browser never runs Google JS against our origin.
4. Record the project id, the three client names, the exact URIs registered, and where each secret lives somewhere your team can find it. **Never record the secret values themselves.**

## Setting it on the api service

1. Open the api service's environment variables for the target environment and set `API_PUBLIC_URL`, `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET` (and `OAUTH_ALLOW_SIGNUP` if the default is wrong for the deployment). Use your platform's encrypted secret store if it has one; treat the secret like any other production credential.
2. **Never commit values** - dev credentials go in the local `.env` only, and gitleaks runs on push and will block anything that looks like a leaked secret.
3. Redeploy/restart the api service. Config is read once at boot; a running process does not pick up edited variables.
4. No web-side change: which providers are enabled is discovered at runtime from the API, so the same SPA build serves every environment. There is deliberately no `VITE_` flag for this.

## Verifying

1. The api service starts cleanly (a Joi failure here means the both-or-neither rule or a malformed `API_PUBLIC_URL`).
2. Discovery answers:

   ```sh
   curl -s https://api.example.com/api/auth/oauth/providers
   # {"providers":[{"key":"google"}]}
   ```

3. The `/auth` login page shows the "Continue with Google" button (web only - the packaged desktop app hides it by design; v1 is web-only).
4. Complete one full sign-in round trip and confirm you land back on the app with a session.

## Troubleshooting

| Symptom                                                              | Likely cause                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| api crash-loops after an env edit, Joi error naming `OAUTH_GOOGLE_*` | Half a pair: one of id/secret set, the other empty. Set both or clear both                                                                                                                                                           |
| Google shows `Error 400: redirect_uri_mismatch`                      | The registered URI and `${API_PUBLIC_URL}/api/auth/oauth/google/callback` differ somewhere: http vs https, `www.`, port, a trailing slash, or `API_PUBLIC_URL` points at an internal URL. Compare byte for byte                      |
| Button missing on `/auth`                                            | Provider disabled (empty pair), the environment's API unreachable at page load (discovery fails soft to "no providers"), or you are in the desktop app (hidden by design)                                                            |
| `/api/auth/oauth/google/start` returns 404                           | Provider disabled or unknown key - a disabled provider's routes 404 on purpose                                                                                                                                                       |
| Users bounce back with `?error=oauth_state_expired`                  | More than 10 minutes on Google's screens, a replayed/bookmarked callback URL, or the flow finished in a different browser than it started. If it is systematic, check that the proxy is not stripping the `__Host-oauth_flow` cookie |
| Users bounce back with `?error=oauth_failed`                         | The generic bucket: exchange/signature/nonce failure, Google outage, or an unverified Google email. The `oauth.failure` audit rows carry the reason                                                                                  |

The full meaning of every `?error=` code, including the linking-policy ones (`oauth_account_exists`, `oauth_link_blocked`), is in the [feature page's error table](/backend/google-sign-in/#what-each-error-code-means).
