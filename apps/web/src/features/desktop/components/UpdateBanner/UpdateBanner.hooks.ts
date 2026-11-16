import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from '@tanstack/react-router';
import { IS_ELECTRON } from '@/lib/electron';
import { useUpdateStore } from '@/stores/update-store';
import type { IUpdateBannerView } from './UpdateBanner.types';

const ERROR_AUTO_DISMISS_MS = 10_000;

export function useUpdateBanner(): IUpdateBannerView | null {
  const { t } = useTranslation();
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const undismiss = useUpdateStore((s) => s.undismiss);
  const router = useRouter();
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === 'error') {
      errorTimerRef.current = setTimeout(() => {
        dismiss();
      }, ERROR_AUTO_DISMISS_MS);
    }
    return () => {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    };
  }, [status, dismiss]);

  // Reappear on navigation when update is downloaded
  useEffect(() => {
    if (!IS_ELECTRON) return;
    const unsub = router.subscribe('onBeforeNavigate', () => {
      const currentStatus = useUpdateStore.getState().status;
      if (currentStatus === 'downloaded') {
        undismiss();
      }
    });
    return unsub;
  }, [router, undismiss]);

  // Manual download path: autoDownload is off in main (unsigned builds), so
  // the user's explicit action triggers the download over the existing IPC.
  const handleDownload = useCallback(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.updater.downloadUpdate().catch((err: unknown) => {
      console.error('[updater] downloadUpdate failed', err);
      useUpdateStore.getState().setStatus({
        status: 'error',
        error: err instanceof Error ? err.message : t('desktop.updateBanner.downloadFailed'),
      });
    });
  }, [t]);

  const handleRestart = useCallback(() => {
    window.electronAPI?.updater.installUpdate();
  }, []);

  const handleDismiss = useCallback(() => {
    dismiss();
  }, [dismiss]);

  // Not visible: web mode, dismissed, or no active update
  if (!IS_ELECTRON) return null;
  if (dismissed) return null;
  if (
    status !== 'available' &&
    status !== 'downloading' &&
    status !== 'downloaded' &&
    status !== 'error'
  ) {
    return null;
  }

  // Derived labels: computed here so JSX stays expression-free
  // Leading space on versionLabel preserves the source's " v1.2.3" spacing in context.
  const versionLabel = version ? ` v${version}` : '';
  const progressLabel = progress ? `${Math.round(progress.percent)}%` : '';
  const errorLabel = error ?? t('desktop.updateBanner.unknownError');

  return {
    status,
    versionLabel,
    progressLabel,
    errorLabel,
    onDownload: handleDownload,
    onRestart: handleRestart,
    onDismiss: handleDismiss,
  };
}
