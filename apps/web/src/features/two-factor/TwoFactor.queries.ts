import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

/**
 * The signed-in user's two-factor status: enabled state, remaining recovery
 * codes and trusted-device count. Backs the security settings card.
 *
 * The query key comes from the tRPC option proxy and the result type flows from the status output schema through the
 * generated AppRouter, so no cast or local mirror type is needed.
 */
export function useTwoFactorStatus() {
  return useQuery({ ...trpc.twoFactor.status.queryOptions() });
}
