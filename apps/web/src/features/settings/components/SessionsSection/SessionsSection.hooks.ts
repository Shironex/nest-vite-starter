import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import { formatDate } from '@/lib/format';
import type { ISessionRow, ISessionsSectionView } from './SessionsSection.types';
import { settingsStrings } from '@/features/settings/Settings.strings';

/**
 * User agents are matched most-specific first: Chromium-family browsers all
 * carry `Chrome/` and `Safari/`, so Edge and Opera must win before Chrome, and
 * Chrome before Safari. Same discipline for OS: iOS user agents contain
 * "like Mac OS X" and Android ones contain "Linux".
 */
const BROWSER_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//u, 'Edge'],
  [/\bOPR\//u, 'Opera'],
  [/\bFirefox\//u, 'Firefox'],
  [/\bChrome\//u, 'Chrome'],
  [/\bSafari\//u, 'Safari'],
];

const OS_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/Windows NT/u, 'Windows'],
  [/iPhone|iPad/u, 'iOS'],
  [/Mac OS X/u, 'macOS'],
  [/Android/u, 'Android'],
  [/Linux/u, 'Linux'],
];

const MOBILE_PATTERN = /iPhone|iPad|Android|Mobile/u;

function matchFirst(patterns: readonly (readonly [RegExp, string])[], value: string) {
  return patterns.find(([pattern]) => pattern.test(value))?.[1];
}

/**
 * A human-readable device line from a raw user agent. Best effort by design:
 * the string is client-supplied and free-form, so anything unrecognized reads
 * as the unknown-device copy rather than echoing the raw value into the UI.
 */
function describeUserAgent(
  userAgent: string,
  unknownDevice: string,
): { label: string; isMobile: boolean } {
  const isMobile = MOBILE_PATTERN.test(userAgent);
  const browser = matchFirst(BROWSER_PATTERNS, userAgent);
  const os = matchFirst(OS_PATTERNS, userAgent);
  if (browser !== undefined && os !== undefined) {
    return { label: `${browser} · ${os}`, isMobile };
  }
  return { label: browser ?? os ?? unknownDevice, isMobile };
}

export function useSessionsSection(): ISessionsSectionView {
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery(trpc.sessions.list.queryOptions());
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const invalidateList = () => {
    void queryClient.invalidateQueries(trpc.sessions.list.pathFilter());
  };

  const revokeMutation = useMutation({
    ...trpc.sessions.revoke.mutationOptions(),
    onSuccess: () => {
      toast.success(settingsStrings.sessions.revokedToast);
      invalidateList();
    },
    onError: (error) => {
      toast.error(translateAppError(error) ?? settingsStrings.sessions.revokeFailed);
      // The likeliest failure is a list gone stale (revoked in another tab,
      // expired); refetch so the panel and the toast tell one story.
      invalidateList();
    },
  });

  const revokeOthersMutation = useMutation({
    ...trpc.sessions.revokeOthers.mutationOptions(),
    onSuccess: () => {
      toast.success(settingsStrings.sessions.revokedOthersToast);
      setIsConfirmOpen(false);
      invalidateList();
    },
    onError: (error) => {
      toast.error(translateAppError(error) ?? settingsStrings.sessions.revokeOthersFailed);
      setIsConfirmOpen(false);
      invalidateList();
    },
  });

  const rows: ISessionRow[] = (sessionsQuery.data ?? []).map((session) => {
    const device = describeUserAgent(session.userAgent, settingsStrings.sessions.unknownDevice);
    return {
      id: session.id,
      deviceLabel: device.label,
      ip: session.ip,
      signedIn: settingsStrings.sessions.signedIn({ date: formatDate(session.createdAt) }),
      lastActive: settingsStrings.sessions.lastActive({ date: formatDate(session.lastActive) }),
      isCurrent: session.isCurrent,
      isMobile: device.isMobile,
      revokeAccessibleLabel: settingsStrings.sessions.revokeAccessible({
        device: device.label,
        ip: session.ip,
      }),
    };
  });

  function onRevoke(id: string) {
    revokeMutation.mutate({ sessionId: id });
  }

  function onRevokeOthers() {
    revokeOthersMutation.mutate();
  }

  function onConfirmOpenChange(open: boolean) {
    setIsConfirmOpen(open);
  }

  return {
    state: sessionsQuery.isError
      ? 'error'
      : sessionsQuery.isPending
        ? 'loading'
        : rows.length === 0
          ? 'empty'
          : 'ready',
    rows,
    onRevoke,
    isRevokePending: revokeMutation.isPending,
    revokingId: revokeMutation.isPending ? (revokeMutation.variables?.sessionId ?? null) : null,
    hasOtherSessions: rows.some((row) => !row.isCurrent),
    onRevokeOthers,
    isRevokeOthersPending: revokeOthersMutation.isPending,
    isConfirmOpen,
    onConfirmOpenChange,
  };
}
