import { ipcMain, Notification, BrowserWindow } from 'electron';
import { isSenderFrameAllowed } from '../security';

const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 1024;

let _mainWindow: BrowserWindow | null = null;

export function registerNotificationHandlers(mainWindow: BrowserWindow): void {
  _mainWindow = mainWindow;

  ipcMain.handle('notification:show', (event, options: unknown) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    if (!options || typeof options !== 'object') {
      throw new Error('Notification options must be an object with title and body');
    }

    const raw = options as Record<string, unknown>;
    const title = typeof raw['title'] === 'string' ? raw['title'].slice(0, MAX_TITLE_LENGTH) : '';
    const body = typeof raw['body'] === 'string' ? raw['body'].slice(0, MAX_BODY_LENGTH) : '';

    if (!title) {
      throw new Error('Notification title is required');
    }

    const notification = new Notification({ title, body });

    notification.on('click', () => {
      if (_mainWindow) {
        _mainWindow.show();
        _mainWindow.focus();
      }
    });

    notification.show();
  });
}

export function cleanupNotificationHandlers(): void {
  ipcMain.removeHandler('notification:show');
  _mainWindow = null;
}
