import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditLogListInput } from '@repo/shared/schemas';
import { trpc } from '@/lib/trpc';

/**
 * Reads for the audit trail screen. Every key comes from the tRPC option
 * proxy, and every result type flows from the procedure's output schema
 * through the generated AppRouter - nothing here is cast or mirrored locally.
 */

/**
 * WHY EVERY KEYED LIST HERE CARRIES `placeholderData: keepPreviousData`.
 *
 * A filter, a tab, a page or a search term is part of the query key, so without
 * it every one of those swaps the rows for a skeleton, unmounts the pager under
 * the pointer that just pressed it and drops any count badge to nothing. With
 * it the previous page stays on screen while the next one is fetched, and the
 * two states separate cleanly: `isPending` is the FIRST load and only the first
 * load, `isFetching && isPlaceholderData` is a refresh over rows the reader can
 * still see.
 */

/** One keyset page of the tenant's audit history (ADMIN-only procedure). */
export function useAuditLogList(input: AuditLogListInput) {
  return useQuery({ ...trpc.audit.list.queryOptions(input), placeholderData: keepPreviousData });
}

/**
 * The actor dropdown's options: the tenant's users, via the existing
 * admin-only listUsers procedure (this screen is ADMIN-gated too). One page at
 * the schema's maximum; an organization with more than 100 staff accounts will need a
 * searchable picker, which is deliberately not built speculatively.
 */
export function useAuditActorOptions() {
  return useQuery(trpc.user.listUsers.queryOptions({ limit: 100 }));
}
