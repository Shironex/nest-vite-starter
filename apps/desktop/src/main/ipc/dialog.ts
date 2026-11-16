import { ipcMain, dialog, BrowserWindow } from 'electron';
import { isSenderFrameAllowed } from '../security';

// Sanitize dialog options to only allow safe properties
interface SafeDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  buttonLabel?: string;
}

function sanitizeOptions(options?: unknown): SafeDialogOptions {
  if (!options || typeof options !== 'object') {
    return {};
  }

  const raw = options as Record<string, unknown>;
  const safe: SafeDialogOptions = {};

  if (typeof raw['title'] === 'string') {
    safe.title = raw['title'];
  }
  if (typeof raw['defaultPath'] === 'string') {
    safe.defaultPath = raw['defaultPath'];
  }
  if (typeof raw['buttonLabel'] === 'string') {
    safe.buttonLabel = raw['buttonLabel'];
  }
  if (Array.isArray(raw['filters'])) {
    safe.filters = (raw['filters'] as unknown[]).filter(
      (f): f is { name: string; extensions: string[] } =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as Record<string, unknown>)['name'] === 'string' &&
        Array.isArray((f as Record<string, unknown>)['extensions']) &&
        ((f as Record<string, unknown>)['extensions'] as unknown[]).every(
          (e) => typeof e === 'string',
        ),
    );
  }

  return safe;
}

let _mainWindow: BrowserWindow | null = null;

export function registerDialogHandlers(mainWindow: BrowserWindow): void {
  _mainWindow = mainWindow;

  ipcMain.handle('dialog:open-file', async (event, options?: unknown) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    if (!_mainWindow) return null;
    const sanitized = sanitizeOptions(options);
    const result = await dialog.showOpenDialog(_mainWindow, {
      properties: ['openFile'],
      ...sanitized,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:save-file', async (event, options?: unknown) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    if (!_mainWindow) return null;
    const sanitized = sanitizeOptions(options);
    const result = await dialog.showSaveDialog(_mainWindow, sanitized);
    if (result.canceled || !result.filePath) {
      return null;
    }
    return result.filePath;
  });

  ipcMain.handle('dialog:open-directory', async (event, options?: unknown) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    if (!_mainWindow) return null;
    const sanitized = sanitizeOptions(options);
    const result = await dialog.showOpenDialog(_mainWindow, {
      properties: ['openDirectory'],
      ...sanitized,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });
}

export function cleanupDialogHandlers(): void {
  ipcMain.removeHandler('dialog:open-file');
  ipcMain.removeHandler('dialog:save-file');
  ipcMain.removeHandler('dialog:open-directory');
  _mainWindow = null;
}
