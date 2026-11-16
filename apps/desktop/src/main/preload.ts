import { contextBridge, ipcRenderer } from 'electron';
// TYPE-ONLY import: the preload runs sandboxed (window.ts sets sandbox: true)
// and cannot require() workspace packages at runtime; `import type` is erased
// at compile time, so only the shared contract's types may be used here.
// ElectronAPI is the canonical bridge contract: the renderer types
// window.electronAPI against the same declaration, so the two sides cannot
// drift.
import type {
  DialogOptions,
  ElectronAPI,
  StoreKey,
  StoreValues,
  UpdateStatusPayload,
} from '@repo/shared/desktop';

export type { ElectronAPI } from '@repo/shared/desktop';

const electronAPI: ElectronAPI = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
        callback(maximized);
      ipcRenderer.on('window:maximized-change', handler);
      return () => {
        ipcRenderer.removeListener('window:maximized-change', handler);
      };
    },
  },
  store: {
    get: <K extends StoreKey>(key: K) =>
      ipcRenderer.invoke('store:get', key) as Promise<StoreValues[K] | undefined>,
    set: <K extends StoreKey>(key: K, value: StoreValues[K]) =>
      ipcRenderer.invoke('store:set', key, value) as Promise<void>,
    delete: (key: StoreKey) => ipcRenderer.invoke('store:delete', key) as Promise<void>,
  },
  dialog: {
    openFile: (options?: DialogOptions) => ipcRenderer.invoke('dialog:open-file', options),
    saveFile: (options?: DialogOptions) => ipcRenderer.invoke('dialog:save-file', options),
    openDirectory: (options?: DialogOptions) =>
      ipcRenderer.invoke('dialog:open-directory', options),
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getApiUrl: () => ipcRenderer.invoke('app:get-api-url'),
  },
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    installUpdate: () => ipcRenderer.send('updater:install'),
    getChannel: () => ipcRenderer.invoke('updater:get-channel'),
    setChannel: (channel) => ipcRenderer.invoke('updater:set-channel', channel),
    onUpdateStatus: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatusPayload) =>
        callback(status);
      ipcRenderer.on('updater:status', handler);
      return () => {
        ipcRenderer.removeListener('updater:status', handler);
      };
    },
  },
  notification: {
    show: (options) => ipcRenderer.invoke('notification:show', options),
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
