import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Request body caps, stated instead of inherited.
 *
 * Every value below is body-parser's own default. Restating it is the point:
 * before this helper the cap existed only as a library default, nothing
 * asserted it, and a later `useBodyParser('json', { limit: '50mb' })` or a
 * `bodyParser: false` that forgot to re-register a parser would have changed
 * the attack surface with no test noticing. Raise one of these only for a
 * route that needs it, and say which route in the commit.

 */
export const JSON_BODY_LIMIT = '100kb';
export const URLENCODED_BODY_LIMIT = '100kb';

/**
 * Register every body parser this api accepts, in one place and at one point
 * in the middleware chain.
 *
 * CALL SITE IS LOAD-BEARING. `main.ts` creates the app with
 * `bodyParser: false`, so these two are the only parsers that exist and they
 * sit exactly where this is called. It has to be called AFTER the cookie and
 * CSRF middleware: a parser placed in front of CSRF buffers (and rejects) the
 * body of a request that was never going to be allowed through, which is how
 * an anonymous 101 kB `text/plain` POST to any path used to produce a failure
 * before the request ever met CSRF or the ThrottlerGuard.
 *
 * `urlencoded` keeps `extended: true`, which is what Nest's own default
 * registration passes and what express 5 does NOT default to.
 *
 * Over-cap bodies surface as an http-errors 413 (`expose: true`), which
 * AllExceptionsFilter answers with `appCode: PAYLOAD_TOO_LARGE` at warn level
 * and no Sentry capture.
 */
export function configureBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: URLENCODED_BODY_LIMIT, extended: true });
}
