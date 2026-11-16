import { ipcMain } from 'electron';
import { z } from 'zod';
import { UPDATE_CHANNELS } from '@repo/shared/desktop';
import type { StoreKey, StoreValues } from '@repo/shared/desktop';
// electron-store is ESM-only since v9 and the desktop main bundle is emitted as
// CommonJS, so the package must be loaded via dynamic import. The resolution-mode
// attribute lets the type-only import succeed under module: node16.
import type ElectronStoreType from 'electron-store' with { 'resolution-mode': 'import' };
import { isSenderFrameAllowed } from '../security';

/**
 * Saved main-window geometry. Finite numbers only: the values feed
 * BrowserWindow construction in window.ts, where NaN/Infinity from a tampered
 * store file would produce a broken or invisible window.
 */
export const windowBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  isMaximized: z.boolean(),
});

export type WindowBounds = z.infer<typeof windowBoundsSchema>;

/** Auto-updater release channel; the single source of truth is @repo/shared. */
export const updateChannelSchema = z.enum(UPDATE_CHANNELS);

/**
 * Per-key value schemas for everything the renderer may write via store:set.
 * The key set doubles as the access allowlist; a key without a schema is
 * denied outright. The renderer is the least-trusted process, so its writes
 * are validated here and the trusting main-process readers (window.ts bounds
 * restore, updater channel reads) still re-validate defensively on read.
 */
const STORE_VALUE_SCHEMAS = {
  windowBounds: windowBoundsSchema,
  updateChannel: updateChannelSchema,
  launchOnStartup: z.boolean(),
  // Free-form-ish on purpose: no main-process reader yet; bounded so a rogue
  // renderer cannot bloat the store file. Tighten to an enum when a reader lands.
  minimizeBehavior: z.string().min(1).max(32),
  // Pinned to the shared StoreValues contract: adding/renaming a key or
  // changing a value shape on one side only is a compile error, not drift.
} satisfies { [K in keyof StoreValues]: z.ZodType<StoreValues[K]> };

export type { StoreValues, StoreKey } from '@repo/shared/desktop';

function isAllowedKey(key: string): key is StoreKey {
  return Object.hasOwn(STORE_VALUE_SCHEMAS, key);
}

interface StoreDefaults {
  windowBounds: undefined;
  updateChannel: string;
  launchOnStartup: boolean;
  minimizeBehavior: string;
}

type StoreInstance = ElectronStoreType<StoreDefaults>;

let storeInstance: StoreInstance | null = null;
let storeReady: Promise<StoreInstance> | null = null;

// The first call resolves the module and caches a single instance; subsequent
// calls return the cached promise / instance synchronously after first resolution.
export async function getStore(): Promise<StoreInstance> {
  if (storeInstance) return storeInstance;
  if (storeReady) return storeReady;
  storeReady = import('electron-store').then(({ default: ElectronStore }) => {
    const instance = new ElectronStore<StoreDefaults>({
      defaults: {
        windowBounds: undefined,
        updateChannel: 'stable',
        launchOnStartup: false,
        minimizeBehavior: 'minimize',
      },
    });
    storeInstance = instance;
    return instance;
  });
  return storeReady;
}

/**
 * `key` arrives from the renderer as `unknown`, so it is narrowed before it is
 * used. `isAllowedKey` alone happens to coerce a non-string safely today via
 * `Object.hasOwn`, but the annotation is the boundary and it should say what is
 * actually true: a later switch to `key in ...` or a `switch` would throw on a
 * `{}` instead of rejecting it.
 */
function requireAllowedKey(key: unknown): StoreKey {
  if (typeof key !== 'string' || !isAllowedKey(key)) {
    throw new Error(`Access denied: key "${String(key)}" is not whitelisted`);
  }
  return key;
}

export function registerStoreHandlers(): void {
  ipcMain.handle('store:get', async (event, rawKey: unknown) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    const key = requireAllowedKey(rawKey);
    const store = await getStore();
    // Parsed on the way OUT as well as on the way in. store:set validates
    // writes, but config.json is a plain file the user can edit, and the two
    // main-process readers of this same store (window.ts bounds restore,
    // updater channel read) already re-validate. This path returning raw JSON
    // typed as StoreValues[K] was the one boundary that trusted the disk.
    return STORE_VALUE_SCHEMAS[key].safeParse(store.get(key)).data;
  });

  ipcMain.handle('store:set', async (event, rawKey: unknown, value: unknown) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    const key = requireAllowedKey(rawKey);
    const parsed = STORE_VALUE_SCHEMAS[key].safeParse(value);
    if (!parsed.success) {
      throw new Error(`Invalid value for store key "${key}"`);
    }
    const store = await getStore();
    store.set(key, parsed.data);
  });

  ipcMain.handle('store:delete', async (event, rawKey: unknown) => {
    if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
    const key = requireAllowedKey(rawKey);
    const store = await getStore();
    store.delete(key);
  });
}

export function cleanupStoreHandlers(): void {
  ipcMain.removeHandler('store:get');
  ipcMain.removeHandler('store:set');
  ipcMain.removeHandler('store:delete');
}
