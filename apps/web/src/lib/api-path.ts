/**
 * Validate a server-supplied, api-relative URL before the client fetches it.
 *
 * Download and upload tickets come back as a path (`/api/...`) that the client
 * fetches same-origin. That only holds when the path starts with exactly one
 * `/`: a `//host/x` path is scheme-relative and leaves the origin. A backslash is read as `/` by
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
