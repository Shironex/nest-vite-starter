/**
 * Validate a server-supplied, api-relative URL before it is appended to
 * `getApiBaseUrl()`.
 *
 * Download and upload tickets come back as a path (`/api/...`) that the client
 * prefixes with the api origin. Concatenation only keeps that origin when the
 * path starts with exactly one `/`: in web mode the base is `''`, so a
 * `//host/x` path is scheme-relative and leaves the origin, and in Electron an
 * `@host/x` path turns the base into userinfo. A backslash is read as `/` by
 * browsers, and a control or whitespace character is parser-confusion fodder,
 * so both are refused as well.
 *
 * Throws rather than falling back: there is no safe default ticket, and every
 * caller already classifies a throw from its fetch as an unexpected failure.
 */
export function toApiPath(url: string): string {
  if (
    url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.includes('\\') &&
    ![...url].some((ch) => ch.charCodeAt(0) <= 0x20 || ch.charCodeAt(0) === 0x7f)
  ) {
    return url;
  }
  throw new Error('Refusing a non-relative api path');
}
