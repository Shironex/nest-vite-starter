import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UpdateChannel } from '@repo/shared/desktop';
import { useUpdateStore } from '@/stores/update-store';
import type { IUpdatesSectionView } from './UpdatesSection.types';

export function useUpdatesSection(): IUpdatesSectionView {
  const { t } = useTranslation();
  const { status, version: updateVersion, channel } = useUpdateStore();
  const selectChannel = useUpdateStore((s) => s.selectChannel);
  // null = still loading (renders a skeleton); 'Unknown' = IPC failed/empty or
  // no bridge at all. Never leaves the UI on a forever-"Loading..." string.
  // Lazy initializer: without the Electron bridge there is nothing to await.
  const [appVersion, setAppVersion] = useState<string | null>(() =>
    window.electronAPI ? null : 'Unknown',
  );

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    // The IPC call cannot be aborted, so the cleanup only stops a late answer
    // from updating a section that has already unmounted.
    let cancelled = false;
    api.app
      .getVersion()
      .then((v) => {
        if (cancelled) return;
        setAppVersion(v ? v : 'Unknown');
      })
      .catch((error: unknown) => {
        console.error('[updater] app.getVersion failed', error);
        if (cancelled) return;
        setAppVersion('Unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateVersionLabel = updateVersion ? `v${updateVersion}` : '';

  const handleCheckForUpdates = useCallback(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.updater.checkForUpdates().catch((error: unknown) => {
      console.error('[updater] checkForUpdates failed', error);
      // Route the rejection into the store's error status so the existing
      // "Update check failed" indicator renders instead of failing silently.
      useUpdateStore.getState().setStatus({
        status: 'error',
        error: error instanceof Error ? error.message : t('settings.updates.checkError'),
      });
    });
  }, [t]);

  // Manual download path: autoDownload is off in main (unsigned builds), so
  // the user's explicit action triggers the download over the existing IPC.
  const handleDownloadUpdate = useCallback(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.updater.downloadUpdate().catch((error: unknown) => {
      console.error('[updater] downloadUpdate failed', error);
      useUpdateStore.getState().setStatus({
        status: 'error',
        error: error instanceof Error ? error.message : t('settings.updates.downloadError'),
      });
    });
  }, [t]);

  const handleChannelChange = useCallback(
    (newChannel: UpdateChannel) => {
      // Optimistic set + IPC write + rollback live in the store action.
      selectChannel(newChannel);
    },
    [selectChannel],
  );

  const handleInstallUpdate = useCallback(() => {
    window.electronAPI?.updater.installUpdate();
  }, []);

  return {
    status,
    appVersion,
    updateVersionLabel,
    channel,
    handleCheckForUpdates,
    handleDownloadUpdate,
    handleChannelChange,
    handleInstallUpdate,
  };
}
