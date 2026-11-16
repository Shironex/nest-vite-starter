import { ipcMain, BrowserWindow } from 'electron';
import { isSenderFrameAllowed } from '../security';

let _mainWindow: BrowserWindow | null = null;

export function registerWindowHandlers(mainWindow: BrowserWindow): void {
  _mainWindow = mainWindow;

  ipcMain.on('window:minimize', (event) => {
    if (!isSenderFrameAllowed(event)) return;
    mainWindow.minimize();
  });

  ipcMain.on('window:maximize', (event) => {
    if (!isSenderFrameAllowed(event)) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window:close', (event) => {
    if (!isSenderFrameAllowed(event)) return;
    mainWindow.close();
  });

  ipcMain.handle('window:is-maximized', (event) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    return mainWindow.isMaximized();
  });

  // Forward maximize/unmaximize events to renderer
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-change', false);
  });
}

export function cleanupWindowHandlers(): void {
  ipcMain.removeAllListeners('window:minimize');
  ipcMain.removeAllListeners('window:maximize');
  ipcMain.removeAllListeners('window:close');
  ipcMain.removeHandler('window:is-maximized');
  _mainWindow = null;
}
