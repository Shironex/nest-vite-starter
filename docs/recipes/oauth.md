# Recipe: sign in with Google or GitHub (OAuth)

**When you need it:** users should sign in with an existing identity provider. The starter has
password sign-in only, and the interim auth is due to be replaced, so build this against the seam,
not around it.

## Shape of the change

- **Where it plugs in.** OAuth is another door into a session. It must end in
  `TwoFactorChallengeService.beginOrEstablish`, so a deleted, locked or disabled account is refused
  and a user with 2FA still gets challenged. Register the new file in `tools/lint-meta/registry.ts`
  (`establish-session-callers`, `session-landing-declared`), which makes the gate fail until you
  have classified it. See [auth.md](../auth.md). When `@noctcore/auth` arrives, prefer its provider
  support to this hand-built version.
- **Flow.** Authorization code with PKCE. Two plain HTTP controllers (redirects are what
  controllers are for, as `/api/csrf-token` is): `GET /api/auth/<provider>` stores `state` and the PKCE
  verifier in Redis keyed by a random id (short TTL, single use) and redirects; the callback checks
  `state`, exchanges the code with `fetch`, reads the verified profile, and finds or creates the
  user.
- **Identity model.** An `OAuthAccount` table: `provider`, `providerUserId` (unique together),
  `userId`. Link by provider id, never by email alone.
- **Account linking.** Only link an existing password account when the provider says the email is
  verified, and ask for the password (or a mailed confirmation) first. Auto-linking on an
  unverified email is account takeover. Decide what unlinking means for an account that has no
  password, and keep at least one way in.
- **Config.** Client id and secret as env keys, refused empty in production when the provider is
  enabled, and exact redirect URIs per environment.
- **Web.** A button that navigates to the api route (a full page navigation, not a fetch), and a
  settings row to link or unlink.

## Pitfalls

- Validate `state` and bind it to the browser (a cookie or the stored id), or the callback is open
  to login CSRF.
- A provider email can change or be recycled. The provider's stable user id is the identity.
- Rate limit the callback, audit link, unlink and sign-in, and add the provider origins to the CSP
  only where a browser actually connects (it does not, in a redirect flow).
- Test with a stub provider server in the integration job rather than the real one.
