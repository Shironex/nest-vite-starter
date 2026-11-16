import { DEFAULT_COLOR_THEME } from '@repo/ui/theme';
import type { ColorTheme, ThemeMode } from '@repo/ui/theme';

export type ThemePreference = ThemeMode;

const darkMediaQuery = '(prefers-color-scheme: dark)';

/**
 * The theme actually painted right now: the preference itself, or what the OS
 * says when the preference is `system`.
 *
 * Exported because the app's resolution is NOT the same as
 * `prefers-color-scheme`. SaaS Starter applies a `.dark` class from a stored
 * preference, so any third-party surface that resolves the OS query on its own
 * (sonner's `theme="system"`, for one) disagrees with the app the moment a user
 * picks a theme in Settings. Such surfaces get this value instead.
 */
export function resolveEffectiveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia(darkMediaQuery).matches ? 'dark' : 'light';
  }
  return theme;
}

/** Apply theme class to document root. Call with user's theme preference. */
export function applyTheme(theme: ThemePreference): void {
  const effective = resolveEffectiveTheme(theme);
  document.documentElement.classList.toggle('dark', effective === 'dark');
}

/**
 * Apply color theme via data-theme attribute on document root.
 *
 * The default theme is the one @repo/ui authors on bare `:root`, so it is
 * expressed as the ABSENCE of the attribute. Every other theme sets it.
 * Keep this keyed off DEFAULT_COLOR_THEME, never off a hardcoded theme id:
 * hardcoding it is what made "Violet" silently render the default palette.
 */
export function applyColorTheme(theme: ColorTheme): void {
  if (theme === DEFAULT_COLOR_THEME) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/**
 * Watch for system theme preference changes.
 * Returns a cleanup function to remove the listener.
 */
export function watchSystemTheme(callback: () => void): () => void {
  const mql = window.matchMedia(darkMediaQuery);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}
