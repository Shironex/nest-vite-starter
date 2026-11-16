import { ipcMain, app } from 'electron';
import { getApiUrl } from '../api-url';
import { isSenderFrameAllowed } from '../security';

let registered = false;

export function registerAppHandlers(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('app:get-version', (event) => {
    if (!isSenderFrameAllowed(event)) return null;
    return app.getVersion();
  });

  ipcMain.handle('app:get-api-url', (event) => {
    if (!isSenderFrameAllowed(event)) return null;
    return getApiUrl();
  });
}

export function cleanupAppHandlers(): void {
  ipcMain.removeHandler('app:get-version');
  ipcMain.removeHandler('app:get-api-url');
}
