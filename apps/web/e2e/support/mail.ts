/**
 * Where the local mail catcher listens.
 *
 * Env-driven, with the docker-compose port as the default so CI (which sets
 * nothing) is unaffected. A hardcoded `:8025` made a spec read the mail of
 * whatever mailpit happened to own that port: with `pnpm e2e:lane`, the api
 * delivers to the run's own sandbox mailpit on a random port while the spec
 * looked in the dev stack's, so the invite it was waiting for never arrived.
 * A run that owns its own mail catcher passes the port it actually got.
 */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
