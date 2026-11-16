import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { getAppErrorCode, translateAppError } from '@/lib/trpc-errors';
import { formatDate } from '@/lib/i18n';
import { getApiBaseUrl, IS_ELECTRON } from '@/lib/electron';
import {
  isOAuthProviderKey,
  oauthLinkStartPath,
  oauthProviderDisplayName,
  OAUTH_LINKED_PARAM,
  OAUTH_PROVIDER_NAMES,
} from '@/features/auth/Auth.constants';
import type { OAuthProviderKey } from '@/features/auth/Auth.constants';
import {
  fetchEnabledProviders,
  OAUTH_PROVIDERS_QUERY_KEY,
} from '@/features/auth/components/OAuthButtons/OAuthButtons.hooks';
import { useOAuthAccounts } from '@/features/auth/ConnectedAccounts.queries';
import type { IConnectedAccountsSectionView } from './ConnectedAccountsSection.types';

/**
 * The Connected Accounts panel state (SPEC sections 8 and 9 item 5).
 *
 * SUDO GATES BOTH ACTIONS, DIFFERENTLY. Link is a full-page navigation whose
 * sudo failure comes back as an `/auth?error=oauth_failed` redirect, so the
 * dialog runs BEFORE leaving and the grant is seconds old when `/start` checks
 * it. Unlink is a tRPC call that answers FORBIDDEN when the grant is missing,
 * so it attempts FIRST and treats FORBIDDEN as "open the dialog and retry".
 * That order is deliberate: the 300 s window routinely expires while the page
 * sits open, so FORBIDDEN is the normal flow here, not an error state, and
 * attempting first is what spares a user with a live grant a second prompt.
 */
export function useConnectedAccountsSection(): IConnectedAccountsSectionView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { [OAUTH_LINKED_PARAM]?: string };

  const accountsQuery = useOAuthAccounts();

  // Same query as the sign-in buttons (shared key, shared cache): which
  // providers exist is deployment configuration. The Electron shell never
  // asks, and with no discovery there are no link buttons there; the list and
  // unlink still work, they are plain tRPC.
  const providersQuery = useQuery({
    queryKey: OAUTH_PROVIDERS_QUERY_KEY,
    queryFn: fetchEnabledProviders,
    staleTime: Infinity,
    enabled: !IS_ELECTRON,
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingLink, setPendingLink] = useState<OAuthProviderKey | null>(null);
  const [pendingUnlinkId, setPendingUnlinkId] = useState<string | null>(null);

  const unlinkMutation = useMutation({
    ...trpc.oauth.unlink.mutationOptions(),
    onSuccess: () => {
      toast.success(t('auth.connectedAccounts.unlinkedToast'));
      void queryClient.invalidateQueries(trpc.oauth.listAccounts.pathFilter());
    },
    onError: (error, variables) => {
      const code = getAppErrorCode(error);
      if (code === AppErrorCode.FORBIDDEN) {
        // No live sudo grant. Remember the row from the mutation's own
        // variables (not component state, which a re-render could have
        // dropped) and re-prompt; onSudoConfirmed retries it.
        setPendingUnlinkId(variables.accountId);
        setIsDialogOpen(true);
      } else if (code === AppErrorCode.NOT_FOUND) {
        // Not this user's row anymore, likely unlinked in another tab; the
        // list is stale, so refresh it along with the sentence.
        toast.error(t('errors:NOT_FOUND'));
        void queryClient.invalidateQueries(trpc.oauth.listAccounts.pathFilter());
      } else {
        // PASSWORD_NOT_SET here is the last-credential invariant refusing
        // (passwordless account, no other linked account); the catalog copy
        // already points at password reset, which doubles as set-password.
        toast.error(translateAppError(error) ?? t('errors.unexpected'));
      }
    },
  });

  /**
   * The `?oauth_linked=<provider>` search param is the link-success signal
   * from the callback 302 (OAUTH_LINKED_PARAM in the api's oauth.constants).
   * Announce it once and strip it from the URL so a refresh or a shared link
   * does not re-announce. The ref guards StrictMode's double effect run; the
   * replace guards history so Back does not resurrect the param.
   */
  const announcedLinkRef = useRef(false);
  const linkedKey = search[OAUTH_LINKED_PARAM];
  useEffect(() => {
    if (!isOAuthProviderKey(linkedKey) || announcedLinkRef.current) return;
    announcedLinkRef.current = true;
    toast.success(
      t('auth.connectedAccounts.linkedToast', { provider: oauthProviderDisplayName(linkedKey) }),
    );
    void navigate({ to: '/settings', search: {}, replace: true });
  }, [linkedKey, navigate, t]);

  const accounts = accountsQuery.data?.accounts ?? [];
  const rows = accounts.map((account) => {
    const providerName = oauthProviderDisplayName(account.provider);
    return {
      id: account.id,
      providerName,
      email: account.email,
      linkedOn: t('auth.connectedAccounts.linkedOn', { date: formatDate(account.createdAt) }),
      lastUsed: t('auth.connectedAccounts.lastUsed', { date: formatDate(account.lastUsedAt) }),
      unlinkAccessibleLabel: t('auth.connectedAccounts.unlinkAccessible', {
        provider: providerName,
        email: account.email,
      }),
    };
  });

  const linkedProviders = new Set(accounts.map((account) => account.provider));
  const linkOptions = (providersQuery.data ?? [])
    .filter((key) => !linkedProviders.has(key))
    .map((key) => ({
      key,
      label: t('auth.connectedAccounts.linkCta', { provider: OAUTH_PROVIDER_NAMES[key] }),
    }));

  function onLink(key: OAuthProviderKey) {
    setPendingUnlinkId(null);
    setPendingLink(key);
    setIsDialogOpen(true);
  }

  function onUnlink(accountId: string) {
    unlinkMutation.mutate({ accountId });
  }

  function onSudoConfirmed() {
    if (pendingLink !== null) {
      // Full-page navigation: /start answers with a 302 into the provider's
      // consent screen, which fetch cannot follow. The api pins the flow back
      // to /settings?oauth_linked=<provider>.
      window.location.assign(getApiBaseUrl() + oauthLinkStartPath(pendingLink));
      return;
    }
    if (pendingUnlinkId !== null) {
      const accountId = pendingUnlinkId;
      setPendingUnlinkId(null);
      unlinkMutation.mutate({ accountId });
    }
  }

  function onDialogOpenChange(open: boolean) {
    setIsDialogOpen(open);
    if (!open) {
      // Canceling abandons the pending action. Runs AFTER a successful
      // confirm too, harmlessly: onConfirmed fires first (the dialog's
      // ordering contract) and has already consumed the pending value.
      setPendingLink(null);
      setPendingUnlinkId(null);
    }
  }

  return {
    state: accountsQuery.isError
      ? 'error'
      : accountsQuery.isPending
        ? 'loading'
        : rows.length === 0
          ? 'empty'
          : 'ready',
    rows,
    linkOptions,
    onLink,
    onUnlink,
    isUnlinkPending: unlinkMutation.isPending,
    unlinkingId: unlinkMutation.isPending ? (unlinkMutation.variables?.accountId ?? null) : null,
    isDialogOpen,
    onDialogOpenChange,
    onSudoConfirmed,
  };
}
