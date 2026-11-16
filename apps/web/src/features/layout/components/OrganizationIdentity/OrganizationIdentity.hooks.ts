import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { getInitials } from '@/lib/avatar';
import { USER_ME_STALE_TIME } from '@/hooks/use-auth';
import type { OrganizationIdentityState } from './OrganizationIdentity.types';

/**
 * The signed-in staff member's organization (tenant), for the sidebar footer.
 *
 * `user.tenant` resolves the name server-side from the session, never from a
 * client-supplied id. `User.tenantId` is nullable for pre-tenant seed data, so
 * a null name is a real state to render rather than an error: the fallback
 * keeps the footer looking finished instead of blank. A failed lookup draws the
 * same fallback, so the footer is never missing once the query settles.
 */
export function useOrganizationIdentity(): OrganizationIdentityState {
  const { t } = useTranslation();
  const { data, isPending } = useQuery({
    ...trpc.user.tenant.queryOptions(),
    staleTime: USER_ME_STALE_TIME,
  });

  if (isPending) return { status: 'pending' };

  // Not pending and no data means the query errored. A failed background
  // refetch keeps the last good `data`, so that case stays `ready`.
  const name = data?.name ?? t('organizationIdentity.fallbackName');

  return {
    status: data ? 'ready' : 'error',
    name,
    initial: getInitials(name, ''),
  };
}
