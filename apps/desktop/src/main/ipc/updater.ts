import { ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UPDATE_CHANNELS } from '@repo/shared/desktop';
import { isSenderFrameAllowed } from '../security';
import { getStore, updateChannelSchema } from './store';

// Derived from the shared channel list so this allowlist can never drift from
// the contract the renderer types against.
const VALID_CHANNELS = new Set<string>(UPDATE_CHANNELS);

export function registerUpdaterHandlers(): void {
  // The preload declares these as Promise<void>: await the operation and
  // return null so the wire matches the declared type. electron-updater's
  // UpdateCheckResult is not guaranteed structured-cloneable, and results
  // flow to the renderer via updater:status events, not the invoke result.
  ipcMain.handle('updater:check', async (event) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    await autoUpdater.checkForUpdates();
    return null;
  });

  ipcMain.handle('updater:download', async (event) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    await autoUpdater.downloadUpdate();
    return null;
  });

  // ipcMain.on (fire-and-forget): quitAndInstall doesn't return
  ipcMain.on('updater:install', (event) => {
    if (!isSenderFrameAllowed(event)) return;
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('updater:get-channel', async (event) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    const store = await getStore();
    // Defensive read: store:set validates writes, but the store file on disk
    // is user-editable, so an unknown value still falls back to 'stable'.
    return updateChannelSchema.catch('stable').parse(store.get('updateChannel'));
  });

  ipcMain.handle('updater:set-channel', async (event, channel: unknown) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    if (typeof channel !== 'string' || !VALID_CHANNELS.has(channel)) {
      throw new Error(`Invalid update channel: "${String(channel)}". Must be "stable" or "beta".`);
    }
    const store = await getStore();
    store.set('updateChannel', channel);
    autoUpdater.channel = channel;
    // Re-check for updates on the new channel
    void autoUpdater.checkForUpdates();
  });
}

export function cleanupUpdaterHandlers(): void {
  ipcMain.removeHandler('updater:check');
  ipcMain.removeHandler('updater:download');
  ipcMain.removeAllListeners('updater:install');
  ipcMain.removeHandler('updater:get-channel');
  ipcMain.removeHandler('updater:set-channel');
}
