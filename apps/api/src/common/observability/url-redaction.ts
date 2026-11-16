import { redactCredentialSegments } from '@repo/shared/logger';

/**
 * The redaction every URL-shaped value in an error log goes through
 * (`AllExceptionsFilter`).
 *
 * A request target carries two kinds of secret, the same exposure
 * `buildRequestContextStore`'s `pathOverride` and `redactCredentialPath` close
 * for the request context:
 *
 * - path-segment credentials: whatever `CREDENTIAL_PATH_PREFIXES` in
 *   `@repo/shared/logger` declares (a route whose URL IS the credential);
 * - the query string: a mailed token, or the web's batched tRPC GET, whose
 *   `input=` is the JSON of every procedure input in the batch (search terms,
 *   record ids).
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
 * `redactCredentialSegments`) and then any query string. Idempotent, so text
 * that was already redacted passes through unchanged.
 */
export function redactUrlText(text: string): string {
  return redactCredentialSegments(text).replace(PATH_QUERY, `$1?${REDACTED}`);
}
