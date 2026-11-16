/**
 * API URL management for external API mode.
 * The API URL is configured at build time and defaults to localhost:3000 for development.
 */
import { createLogger } from '@repo/shared/logger';

const logger = createLogger('ApiUrl');

const FALLBACK_API_URL = 'http://localhost:3000';

/**
 * Validate the env-provided API_URL at startup. The value feeds CSP
 * construction (window.ts connect-src) and the renderer's base URL, so a
 * malformed value must not propagate: fall back to the default and warn.
 * Only http(s) is accepted; the CSP builds its ws(s) source by rewriting
 * the scheme, which is meaningless for anything else.
 */
function resolveApiUrl(raw: string | undefined): string {
  if (!raw) return FALLBACK_API_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`unsupported protocol "${parsed.protocol}"`);
    }
    // Return the original string (not URL#toString) to avoid introducing a
    // trailing slash that consumers concatenating paths do not expect.
    return raw;
  } catch (error) {
    logger.warn(
      `Malformed API_URL "${raw}" (${error instanceof Error ? error.message : String(error)}); falling back to ${FALLBACK_API_URL}`,
    );
    return FALLBACK_API_URL;
  }
}

const API_URL = resolveApiUrl(process.env['API_URL']);

export function getApiUrl(): string {
  return API_URL;
}
