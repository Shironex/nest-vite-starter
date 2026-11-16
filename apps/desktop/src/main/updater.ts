import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo, ProgressInfo } from 'electron-updater';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@repo/shared/logger';
import type { UpdateStatusPayload } from '@repo/shared/desktop';
import { getStore, updateChannelSchema } from './ipc/store';

function buildLogger() {
  try {
    const logDir = app.getPath('logs');
    const logPath = join(logDir, 'updater.log');
    const stream = createWriteStream(logPath, { flags: 'a' });
    const fileTransport = (line: string) => stream.write(line);
    return createLogger('Updater', { fileTransport });
  } catch {
    // If we can't open the log file, fall back to stdout only
    return createLogger('Updater');
  }
}

const logger = buildLogger();

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Initialize the auto-updater with S3-based update checking.
 * Checks for updates in the background; downloads and installs happen only
 * on explicit user action (updater:download / updater:install IPC). Status
 * is forwarded to the renderer via IPC so the update UI can display it.
 *
 * No-op in development mode.
 */
export async function initializeAutoUpdater(
  mainWindow: BrowserWindow,
  isDev: boolean,
): Promise<void> {
  if (isDev) {
    logger.info('Auto-updater disabled in dev mode');
    return;
  }

  // Both stay OFF until code signing lands: with unsigned S3 binaries,
  // auto-download plus install-on-quit would silently install artifacts the
  // OS cannot verify. The user must explicitly trigger download (renderer
  // "Download" action -> updater:download) and install ("Restart Now" ->
  // updater:install).
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Read channel preference from electron-store (ESM-only, lazy-loaded).
  // Defensive parse: store:set validates writes, but the store file on disk is
  // user-editable, so an unknown value still falls back to 'stable'.
  const store = await getStore();
  const channel = updateChannelSchema.catch('stable').parse(store.get('updateChannel'));
  autoUpdater.channel = channel;

  // Forward all updater events to the renderer
  function send(payload: UpdateStatusPayload): void {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', payload);
    }
  }

  autoUpdater.on('checking-for-update', () => {
    send({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    const payload: UpdateStatusPayload = {
      status: 'available',
      version: info.version,
    };
    if (typeof info.releaseNotes === 'string') {
      payload.releaseNotes = info.releaseNotes;
    }
    send(payload);
  });

  autoUpdater.on('update-not-available', () => {
    send({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    send({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    send({
      status: 'downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (err: Error) => {
    send({ status: 'error', error: err.message });
  });

  // Check on launch
  void autoUpdater.checkForUpdates();

  // Check periodically
  setInterval(() => {
    void autoUpdater.checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
}
