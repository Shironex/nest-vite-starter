/**
 * Desktop updater contract shared by the Electron main process (emitter), the
 * preload bridge, and the web renderer (consumer). Single source of truth so
 * the IPC payload shape and the channel list can never drift between sides.
 *
 * NOTE: the preload script runs sandboxed and must only import TYPES from this
 * module (erased at compile time); value imports (UPDATE_CHANNELS) are fine in
 * the main process and the renderer.
 */

/** Release channels the auto-updater can track. */
export const UPDATE_CHANNELS = ['stable', 'beta'] as const;

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/**
 * Payload of the `updater:status` IPC event, forwarded from electron-updater
 * events in the main process to the renderer's update store.
 */
export interface UpdateStatusPayload {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; transferred: number; total: number };
  error?: string;
}

/**
 * Values the renderer may read/write through the store IPC. The desktop main
 * process pins its per-key zod validators to this shape with `satisfies`
 * (ipc/store.ts), so a one-sided change fails to compile instead of drifting.
 */
export interface StoreValues {
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    isMaximized: boolean;
  };
  updateChannel: UpdateChannel;
  launchOnStartup: boolean;
  minimizeBehavior: string;
}

export type StoreKey = keyof StoreValues;

/**
 * Options accepted by the dialog IPC handlers. The main process strips
 * everything else (sanitizeOptions in ipc/dialog.ts), so this is the honest
 * wire contract, not a convenience type.
 */
export interface DialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  buttonLabel?: string;
}

/** `process.platform` values, spelled out so this module needs no Node types. */
export type DesktopPlatform =
  | 'aix'
  | 'android'
  | 'cygwin'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'netbsd'
  | 'openbsd'
  | 'sunos'
  | 'win32';

/**
 * The contextBridge surface exposed as `window.electronAPI`. Implemented by
 * the desktop preload (apps/desktop/src/main/preload.ts) and consumed by the
 * web renderer; both sides type against this single declaration.
 */
export interface ElectronAPI {
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  };
  store: {
    get: <K extends StoreKey>(key: K) => Promise<StoreValues[K] | undefined>;
    set: <K extends StoreKey>(key: K, value: StoreValues[K]) => Promise<void>;
    delete: (key: StoreKey) => Promise<void>;
  };
  dialog: {
    openFile: (options?: DialogOptions) => Promise<string | null>;
    saveFile: (options?: DialogOptions) => Promise<string | null>;
    openDirectory: (options?: DialogOptions) => Promise<string | null>;
  };
  app: {
    getVersion: () => Promise<string | null>;
    getApiUrl: () => Promise<string | null>;
  };
  updater: {
    checkForUpdates: () => Promise<void>;
    downloadUpdate: () => Promise<void>;
    installUpdate: () => void;
    getChannel: () => Promise<UpdateChannel>;
    setChannel: (channel: UpdateChannel) => Promise<void>;
    onUpdateStatus: (callback: (status: UpdateStatusPayload) => void) => () => void;
  };
  notification: {
    show: (options: { title: string; body: string }) => Promise<void>;
  };
  platform: DesktopPlatform;
}
