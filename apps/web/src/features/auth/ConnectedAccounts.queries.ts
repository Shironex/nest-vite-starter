import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

/**
 * The session user's linked OAuth sign-in methods (SPEC section 8), oldest
 * link first. Rows are identified by the OAuthAccount `id`, never the provider
 * key: a user CAN link two Google accounts, so `provider` alone is ambiguous
 * and `oauth.unlink` takes the row id. `email` is the provider-side snapshot,
 * shown so the user can tell which Google account a row is; it may differ from
 * the account email and that is expected. The result type flows from
 * `oauthAccountsOutput` through the generated AppRouter, so no cast or local
 * mirror type is needed.
 */
export function useOAuthAccounts() {
  return useQuery({ ...trpc.oauth.listAccounts.queryOptions() });
}
