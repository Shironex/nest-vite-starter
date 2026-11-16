import type { IncomingMessage } from 'node:http';
import type { Attributes } from '@opentelemetry/api';
import { redactCredentialSegments } from '@repo/shared/logger';

/**
 * The redaction rules every URL-shaped value in a trace goes through: the
 * incoming server span hook below, and `RedactingSpanExporter`, which applies
 * them to every attribute of every span at export time.
 *
 * The request target carries two kinds of secret, the same exposure
 * `buildRequestContextStore`'s `pathOverride` and `redactCredentialPath` close
 * for logs:
 *
 * - path-segment credentials: whatever `CREDENTIAL_PATH_PREFIXES` in
 *   `@repo/shared/logger` declares (a route whose URL IS the credential);
 * - the query string: the OAuth callback's `code=` and `state=`, and the web's
 *   batched tRPC GET, whose `input=` is the JSON of every procedure input in
 *   the batch (search terms, record ids).
 *
 * The query string is dropped wholesale rather than enumerated, so a parameter
 * nobody thought of cannot leak.
 */
export const REDACTED = '[REDACTED]';

/**
 * A path followed by a query string. The path is kept, the query becomes
 * `?[REDACTED]` so a reader still sees that there was one.
 */
const PATH_QUERY = /(\/[^\s"'<>?#]*)\?[^\s"'<>#]*/g;

/**
 * Remove every credential the text can carry as part of a URL, wherever in the
 * text that URL sits: the credential path segments (the shared
 * `redactCredentialSegments`) and then any query string. Idempotent, so a value
 * the server span hook already redacted passes through the exporter unchanged.
 */
export function redactUrlText(text: string): string {
  return redactCredentialSegments(text).replace(PATH_QUERY, `$1?${REDACTED}`);
}

/**
 * URL attributes for an incoming HTTP server span, with every credential the
 * request target can carry removed.
 *
 * `@opentelemetry/instrumentation-http` records the request target verbatim.
 * The installed instrumentation does offer `redactedQueryParamsServer`, but it
 * only blanks named parameters (replacing the default list) and cannot touch a
 * path segment, so it covers neither hazard fully. This hook does.
 *
 * Passed as `startIncomingSpanHook`, whose return value is `Object.assign`ed
 * over the instrumentation's own attributes last, so these values win. Since
 * instrumentation-http 0.221 a server span carries only the stable names, and
 * of those only `url.path` and `url.query` hold the request target (there is
 * no `url.full` on a server span), so those two are the ones overwritten. The
 * old `http.url` / `http.target` names are no longer emitted in any mode. The
 * host is deliberately not rebuilt into anything: it comes from the
 * client-controlled Host header, and the span already carries it as
 * `server.address`.
 *
 * This hook only reaches the server span. Every other span (the nestjs-core
 * handler span's `url.full`, the router's `http.route`) is covered at export
 * time by `RedactingSpanExporter`, with the same rules.
 */
export function redactedIncomingSpanAttributes(request: Pick<IncomingMessage, 'url'>): Attributes {
  const target = request.url ?? '';
  const queryIndex = target.indexOf('?');
  const hasQuery = queryIndex !== -1;
  const safePath = redactUrlText(hasQuery ? target.slice(0, queryIndex) : target);

  const attributes: Attributes = { 'url.path': safePath };

  // Only when the request actually had one: otherwise the attribute would be
  // invented on every span that never carried a query at all.
  if (hasQuery) attributes['url.query'] = REDACTED;

  return attributes;
}
