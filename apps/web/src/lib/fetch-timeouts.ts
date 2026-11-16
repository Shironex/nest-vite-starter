/**
 * Time budgets for the web's own `fetch` calls. `fetch` has no default timeout,
 * so a peer that accepts the connection and stalls would otherwise leave the
 * promise (and whatever awaits it) pending until the tab closes.
 */

/**
 * Small JSON reads (CSRF token, OAuth provider discovery). The CSRF promise is
 * cached, so a hung token fetch would block every mutation until a reload.
 */
export const SMALL_FETCH_TIMEOUT_MS = 10_000;

/**
 * Ticket-redeem document downloads. An `AbortSignal.timeout` bounds the whole
 * transfer, body included, so a stalled stream cannot hang `response.blob()`
 * either. Generous on purpose: documents run to MAX_FILE_SIZE and a slow link
 * must still finish, so this is a stall backstop, not a latency target.
 */
export const DOWNLOAD_FETCH_TIMEOUT_MS = 120_000;
