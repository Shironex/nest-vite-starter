import { app, BrowserWindow, crashReporter, dialog } from 'electron';
import { createLogger } from '@repo/shared/logger';
import { PRODUCT_SLUG } from '@repo/shared/constants';
import { createMainWindow } from './window';
import { registerIpcHandlers, cleanupIpcHandlers } from './ipc-handlers';
import { registerAppProtocol } from './protocol';
import { enforceSingleInstance, hardenWindow } from './security';

const logger = createLogger('Main');

// The crash reporter only records native crashes; JS-level failures in the
// main process would otherwise vanish (no window, no artifact). Log them so
// "app won't open" reports leave something to diagnose.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception in main process', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in main process', reason);
});

// Single-instance lock. A second launch focuses the existing window instead
// of starting another process (which would race on electron-store writes).
const gotLock = enforceSingleInstance();
if (!gotLock) {
  app.quit();

  process.exit(0);
}

// Crash reporter records native crashes (V8, GPU, renderer) to disk. submitURL
// is empty for now; when a Sentry/GlitchTip minidump endpoint is configured,
// point this at /api/14/minidump/?sentry_key=... and crashes upload
// automatically.
crashReporter.start({
  productName: app.getName(),
  companyName: PRODUCT_SLUG,
  submitURL: process.env['CRASH_REPORTER_URL'] ?? '',
  uploadToServer: Boolean(process.env['CRASH_REPORTER_URL']),
  ignoreSystemCrashHandler: false,
});

// Register app:// protocol scheme BEFORE app.whenReady()
registerAppProtocol();

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  // Register app IPC handlers BEFORE creating the window
  // so the renderer can query them as soon as it loads.
  const { registerAppHandlers } = await import('./ipc/app.js');
  registerAppHandlers();

  const isDev = process.env['NODE_ENV'] === 'development';
  mainWindow = await createMainWindow(isDev);
  hardenWindow(mainWindow);

  // Register remaining window-dependent IPC handlers
  registerIpcHandlers(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Focus the existing window when a second-instance launch is attempted
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Without this catch a failed bootstrap (e.g. loadURL rejecting on a corrupt
// renderer bundle) leaves a running process with zero visible windows and no
// signal anywhere: the window is created with show:false and only appears on
// ready-to-show.
app
  .whenReady()
  .then(bootstrap)
  .catch((err: unknown) => {
    logger.error('Bootstrap failed', err);
    dialog.showErrorBox('Failed to start', err instanceof Error ? err.message : String(err));
    app.quit();
  });

// Quit when all windows are closed
app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  cleanupIpcHandlers();
});
