import {
  app,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';

/**
 * Origins the renderer is allowed to navigate to. Anything else is opened in
 * the user's default browser via shell.openExternal: no in-app navigation
 * to attacker-controlled URLs.
 */
const ALLOWED_NAV_ORIGINS = (() => {
  const origins = new Set<string>(['app://app']);
  if (process.env['NODE_ENV'] === 'development') {
    origins.add('http://localhost:5173');
  }
  return origins;
})();

const ALLOWED_SENDER_ORIGINS = ALLOWED_NAV_ORIGINS;

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/**
 * Only http(s) URLs may be handed to shell.openExternal. Other schemes
 * (file:, smb:, custom protocol handlers) can execute code or leak
 * credentials when opened by the OS.
 */
function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Lock the app to a single running instance. A second launch focuses the
 * existing window instead of starting another process. Without this, two
 * launches of the app race to write to the same electron-store / settings
 * file and the user sees data corruption.
 */
export function enforceSingleInstance(): boolean {
  return app.requestSingleInstanceLock();
}

/**
 * Apply navigation, popup, and webview hardening to a freshly created
 * BrowserWindow. Call once per window.
 */
export function hardenWindow(window: BrowserWindow): void {
  // Block all popups; shell.openExternal sends them to the user's default
  // browser instead of opening another Electron BrowserWindow.
  window.webContents.setWindowOpenHandler(({ url }) => {
    // ALLOWED_NAV_ORIGINS includes localhost:5173 only in development, so the
    // dev-server allowance cannot leak into production builds.
    if (ALLOWED_NAV_ORIGINS.has(originOf(url))) {
      return { action: 'allow' };
    }
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Hard-deny same-window navigation away from allowed origins. A phishing
  // link inside the renderer would otherwise replace the SPA.
  window.webContents.on('will-navigate', (event, url) => {
    if (!ALLOWED_NAV_ORIGINS.has(originOf(url))) {
      event.preventDefault();
      if (isExternalHttpUrl(url)) {
        void shell.openExternal(url);
      }
    }
  });

  // <webview> is disabled in webPreferences but belt-and-braces.
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // Block permission prompts (camera, microphone, geolocation, etc.) by
  // default. Add a handler that allows only specific permissions if a real
  // feature ever needs them.
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
}

/**
 * Returns true when an IPC message came from a frame whose origin is in the
 * allowlist. `will-navigate` and `setWindowOpenHandler` keep foreign content
 * out of the window, so this is defense in depth: it is what stops a frame
 * that ever does load remote content from installing an update, switching the
 * release channel or opening a native dialog.
 *
 * It is the first line of every `ipcMain.handle` AND every `ipcMain.on`, which
 * `tools/lint-meta` enforces (`ipc-handlers-guard-sender`) so a handler added
 * later cannot quietly skip it:
 *
 *   ipcMain.handle('app:get-version', (event) => {
 *     if (!isSenderFrameAllowed(event)) return null;
 *     return app.getVersion();
 *   });
 *
 *   ipcMain.on('window:minimize', (event) => {
 *     if (!isSenderFrameAllowed(event)) return;
 *     mainWindow.minimize();
 *   });
 *
 * Accepts both event types because `senderFrame` is the only field it reads
 * and both carry it; a separate helper per event type would be two things to
 * keep in step for no gain.
 */
export function isSenderFrameAllowed(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return ALLOWED_SENDER_ORIGINS.has(originOf(url));
}
