import { useCallback, useEffect, useState } from 'react';
import { IS_ELECTRON } from '@/lib/electron';
import { useAuth } from '@/hooks/use-auth';
import type { ITitleBarView } from './TitleBar.types';

export function useTitleBar(): ITitleBarView | null {
  const [isMaximized, setIsMaximized] = useState(false);
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!IS_ELECTRON) return;

    // Get initial maximized state
    window
      .electronAPI!.window.isMaximized()
      .then(setIsMaximized)
      .catch((error: unknown) => {
        // Non-fatal: the bar just keeps the default restored-state icons.
        console.error('[titlebar] window.isMaximized failed', error);
      });

    // Subscribe to maximized state changes
    const cleanup = window.electronAPI!.window.onMaximizedChange(setIsMaximized);
    return cleanup;
  }, []);

  const onMinimize = useCallback(() => {
    window.electronAPI?.window.minimize();
  }, []);

  const onMaximize = useCallback(() => {
    window.electronAPI?.window.maximize();
  }, []);

  const onClose = useCallback(() => {
    window.electronAPI?.window.close();
  }, []);

  if (!IS_ELECTRON) return null;

  return {
    isMaximized,
    isAuthenticated,
    isLoading,
    onMinimize,
    onMaximize,
    onClose,
  };
}
