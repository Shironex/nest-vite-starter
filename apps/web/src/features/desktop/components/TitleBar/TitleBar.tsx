import { Link } from '@tanstack/react-router';
import { Minus, Square, Copy, X, AppWindow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { useTitleBar } from './TitleBar.hooks';

/**
 * VS Code-style custom title bar for Electron's frameless window.
 * Returns `null` in web mode, completely invisible outside Electron.
 *
 * The window is created with `frame: false` on every platform (no
 * `titleBarStyle: 'hiddenInset'`, no `trafficLightPosition`), so macOS gets the
 * same three custom controls as Windows and Linux and there is no traffic-light
 * inset to reserve. Nothing here is platform conditional.
 *
 * Colors sit on the same SaaS Starter chrome plate as the app shell (`bg-surface`
 * over the `bg-background` app canvas, `border-border` hairline), so the bar
 * reads as one continuous piece of chrome with AppTopbar and AppSidebar in both
 * light and dark. The drag region is carried by the inline `WebkitAppRegion`
 * styles, never by a class, so re-skinning cannot disturb it.
 */
export default function TitleBar() {
  const { t } = useTranslation();
  const view = useTitleBar();

  if (!view) return null;

  const { isMaximized, isAuthenticated, isLoading, onMinimize, onMaximize, onClose } = view;

  return (
    <div
      className="flex h-8 w-full shrink-0 items-center justify-between border-b border-border bg-surface select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left side: app icon + title */}
      <div className="flex items-center gap-2 pl-3">
        <Link
          to="/"
          className="flex items-center gap-2 text-text-secondary transition-colors hover:text-text"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <AppWindow className="h-4 w-4" />
          <span className="type-label-caption">{PRODUCT_NAME}</span>
        </Link>
      </div>

      {/* Center: nav links (no-drag) */}
      {!isLoading && (
        <nav
          className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="rounded-md px-2 py-1 type-label-caption text-text-secondary transition-colors hover:text-text"
            >
              {t('nav.dashboard')}
            </Link>
          ) : (
            <>
              <Link
                to="/auth/login"
                className="rounded-md px-2 py-1 type-label-caption text-text-secondary transition-colors hover:text-text"
              >
                {t('desktop.titleBar.logIn')}
              </Link>
              {/*
               * Weight is the only thing marking Sign up as the primary of the
               * pair, so it keeps a deliberate one-axis bump on top of the ramp
               * entry rather than jumping to a larger slot: the ramp has nothing
               * between Label/Caption (12px/500) and Body/Medium (14px/500), and
               * 14px would not sit in a 32px bar next to its 12px sibling.
               */}
              <Link
                to="/auth/register"
                className="rounded-md px-2 py-1 type-label-caption font-semibold text-text-secondary transition-colors hover:text-text"
              >
                {t('desktop.titleBar.signUp')}
              </Link>
            </>
          )}
        </nav>
      )}

      {/* Right side: window controls (no-drag) */}
      <div
        className="flex h-full items-stretch"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onMinimize}
          className="flex w-12 items-center justify-center text-text-secondary transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={t('desktop.titleBar.minimize')}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onMaximize}
          className="flex w-12 items-center justify-center text-text-secondary transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={isMaximized ? t('desktop.titleBar.restore') : t('desktop.titleBar.maximize')}
        >
          {isMaximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex w-12 items-center justify-center text-text-secondary transition-colors hover:bg-danger-strong hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={t('actions.close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
