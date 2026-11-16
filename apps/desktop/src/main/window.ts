import path from 'node:path';
import { BrowserWindow, screen, session } from 'electron';
import { getApiUrl } from './api-url';
import { getStore, windowBoundsSchema, type WindowBounds } from './ipc/store';
import { setupProtocolHandler } from './protocol';

// How far off a display's work area a saved window position may sit before we
// discard it and fall back to defaults.
const OFFSCREEN_TOLERANCE_PX = 100;

function validateBounds(bounds: WindowBounds): WindowBounds | null {
  const displays = screen.getAllDisplays();
  const isVisible = displays.some((display) => {
    const { x, y, width, height } = display.workArea;
    return (
      bounds.x >= x - OFFSCREEN_TOLERANCE_PX &&
      bounds.y >= y - OFFSCREEN_TOLERANCE_PX &&
      bounds.x < x + width + OFFSCREEN_TOLERANCE_PX &&
      bounds.y < y + height + OFFSCREEN_TOLERANCE_PX
    );
  });

  return isVisible ? bounds : null;
}

function setupContentSecurityPolicy(isDev: boolean, apiUrl: string): void {
  const wsUrl = apiUrl.replace(/^http/, 'ws');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const cspDirectives = [
      isDev ? "script-src 'self' http://localhost:5173 'unsafe-inline'" : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      isDev
        ? `connect-src 'self' http://localhost:5173 ws://localhost:5173 ${apiUrl} ${wsUrl}`
        : `connect-src 'self' ${apiUrl} ${wsUrl}`,
      // <object> would draw an uploaded document in the app's own origin, which
      // is why it stays blocked. The inline preview uses an <iframe sandbox="">
      // over a local blob: handle instead: an opaque origin and no script, so
      // the frame source is the only thing that has to be allowed.
      "object-src 'none'",
      'frame-src blob:',
      // `base-uri` stops an injected <base> from repointing every relative URL
      // on the page; `form-action` stops an injected form from POSTing the
      // session anywhere. Neither is covered by `default-src`.
      "base-uri 'self'",
      "form-action 'self'",
      "default-src 'self'",
    ];
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspDirectives.join('; ')],
      },
    });
  });
}

export async function createMainWindow(isDev: boolean): Promise<BrowserWindow> {
  const apiUrl = getApiUrl();
  setupProtocolHandler();

  // Restore saved window bounds. Defensive parse: store:set validates writes,
  // but the store file on disk is user-editable, so a malformed/non-finite
  // shape falls back to defaults instead of feeding BrowserWindow garbage.
  let savedBounds: WindowBounds | null = null;
  try {
    const store = await getStore();
    const parsed = windowBoundsSchema.safeParse(store.get('windowBounds'));
    if (parsed.success) {
      savedBounds = validateBounds(parsed.data);
    }
  } catch {
    // First run or invalid store: use defaults
  }

  const defaultWidth = 1200;
  const defaultHeight = 800;

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: savedBounds?.width ?? defaultWidth,
    height: savedBounds?.height ?? defaultHeight,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Belt-and-braces. Defaults are fine but stating them in code prevents
      // a "we'll just turn this on for one feature" regression.
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  };

  // Only set position if we have saved bounds (avoids undefined with exactOptionalPropertyTypes)
  if (savedBounds) {
    windowOptions.x = savedBounds.x;
    windowOptions.y = savedBounds.y;
  }

  const mainWindow = new BrowserWindow(windowOptions);

  // Restore maximized state
  if (savedBounds?.isMaximized) {
    mainWindow.maximize();
  }

  // Save window bounds on close. The store acquisition is async (ESM-only
  // electron-store), so we defer the actual close until the write completes
  // to avoid a race where the process exits before the JSON file is flushed.
  let isClosing = false;
  mainWindow.on('close', (event) => {
    if (isClosing) return;
    isClosing = true;
    event.preventDefault();
    const isMaximized = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    void (async () => {
      try {
        const store = await getStore();
        store.set('windowBounds', {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          isMaximized,
        } satisfies WindowBounds);
      } catch {
        // Ignore store errors on close
      } finally {
        mainWindow.destroy();
      }
    })();
  });

  // Setup CSP: always active; dev mode uses relaxed rules (unsafe-inline, localhost)
  setupContentSecurityPolicy(isDev, apiUrl);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load content
  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    await mainWindow.loadURL('app://app/index.html');
  }

  return mainWindow;
}
