import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to re-import the module fresh for each test scenario, so we use
// dynamic imports and resetModules. The module reads `window.electronAPI`
// at import time for IS_ELECTRON.

describe('electron helpers (web mode)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Ensure window.electronAPI is not defined (web mode)
    vi.stubGlobal('electronAPI', undefined);
    (window as unknown as Record<string, unknown>).electronAPI = undefined;
  });

  it('IS_ELECTRON is false in web mode', async () => {
    const { IS_ELECTRON } = await import('@/lib/electron');
    expect(IS_ELECTRON).toBe(false);
  });

  it('initElectron is a no-op in web mode', async () => {
    const { initElectron } = await import('@/lib/electron');
    await expect(initElectron()).resolves.toBeUndefined();
  });

  it('getApiBaseUrl returns empty string in web mode', async () => {
    const { getApiBaseUrl } = await import('@/lib/electron');
    expect(getApiBaseUrl()).toBe('');
  });

  it('getTrpcUrl returns relative /trpc in web mode', async () => {
    const { getTrpcUrl } = await import('@/lib/electron');
    expect(getTrpcUrl()).toBe('/trpc');
  });
});
