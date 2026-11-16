import type { BrowserWindow } from 'electron';
import {
  registerWindowHandlers,
  cleanupWindowHandlers,
  registerStoreHandlers,
  cleanupStoreHandlers,
  registerDialogHandlers,
  cleanupDialogHandlers,
  registerAppHandlers,
  cleanupAppHandlers,
  registerNotificationHandlers,
  cleanupNotificationHandlers,
  registerUpdaterHandlers,
  cleanupUpdaterHandlers,
} from './ipc/index';
import { initializeAutoUpdater } from './updater';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  registerWindowHandlers(mainWindow);
  registerStoreHandlers();
  registerDialogHandlers(mainWindow);
  registerAppHandlers();
  registerNotificationHandlers(mainWindow);
  registerUpdaterHandlers();

  // Initialize auto-updater after IPC handlers are registered
  const isDev = process.env['NODE_ENV'] === 'development';
  void initializeAutoUpdater(mainWindow, isDev);
}

export function cleanupIpcHandlers(): void {
  cleanupWindowHandlers();
  cleanupStoreHandlers();
  cleanupDialogHandlers();
  cleanupAppHandlers();
  cleanupNotificationHandlers();
  cleanupUpdaterHandlers();
}
