import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

/**
 * The signed-in user's two-factor status: enabled state, remaining recovery
 * codes, trusted-device count, and the tenant enforcement policy. Backs the
 * security settings card, the grace banner, and the enroll-only guard.
 *
 * `twoFactor.status` is on the middleware allowlist, so it resolves even for a
 * session flagged `twoFactorEnrollmentRequired` (every other authenticated
 * procedure 403s for that session). The query key comes from the tRPC option
 * proxy and the result type flows from the status output schema through the
 * generated AppRouter, so no cast or local mirror type is needed.
 */
export function useTwoFactorStatus() {
  return useQuery({ ...trpc.twoFactor.status.queryOptions() });
}
