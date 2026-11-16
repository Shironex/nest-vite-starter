// This file is a module (it has an import), so the window augmentation below
// must live in `declare global` to stay visible project-wide.
//
// The bridge surface is typed by the canonical contract in
// @repo/shared/desktop (the same declaration the desktop preload implements),
// so the renderer and preload cannot drift apart.
import type { ElectronAPI } from '@repo/shared/desktop';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
