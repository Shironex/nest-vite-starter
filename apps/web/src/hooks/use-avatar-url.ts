import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { getDownloadUrlFromResult, isHttpUrl } from '@/lib/avatar';

export interface IAvatarUrlState {
  /** A URL an `<img>` can load, or `undefined` when there is none (yet). */
  readonly url: string | undefined;
  /** True while a stored key is being resolved to a presigned URL. */
  readonly isLoading: boolean;
  /** True when resolving a stored key failed; render the initials instead. */
  readonly isError: boolean;
}

/**
 * Resolve `user.avatarUrl` into something an `<img>` can load.
 *
 * The column holds one of two things: an absolute http(s) URL (the picture a
 * Google sign-in brought along), used as is, or an S3 object key from an
 * upload, which is private and has to be exchanged for a presigned download
 * URL through `storage.getUrl`.
 *
 * Every avatar in the app goes through here, so the topbar and the profile
 * card share one query key and one cache entry for the same key: opening
 * Settings never resolves a URL the topbar already has.
 *
 * No console or toast on failure: the global QueryCache onError
 * (lib/trpc.ts) already logs and toasts query failures.
 */
export function useAvatarUrl(avatarUrl: string | null | undefined): IAvatarUrlState {
  const avatarKey = avatarUrl && !isHttpUrl(avatarUrl) ? avatarUrl : null;

  const { data, isLoading, isError } = useQuery({
    ...trpc.storage.getUrl.queryOptions({ key: avatarKey ?? '' }),
    enabled: !!avatarKey,
  });

  if (!avatarKey) {
    return { url: avatarUrl || undefined, isLoading: false, isError: false };
  }

  return { url: getDownloadUrlFromResult(data), isLoading, isError };
}
