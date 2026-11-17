import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_COLOR_THEME } from '@repo/ui/theme';
import type { ColorTheme } from '@repo/ui/theme';
import { applyColorTheme, applyTheme } from './theme';

/**
 * applyColorTheme encodes one rule that is invisible in the types: the default
 * theme is the palette @repo/ui authors on bare `:root`, so it is applied by
 * REMOVING data-theme, and every other theme is applied by SETTING it.
 *
 * A hardcoded theme id in that check once inverted its meaning when the default
 * changed: picking the old default removed the attribute and rendered the new
 * one. Nothing failed, the wrong palette just rendered. These tests pin the rule
 * to DEFAULT_COLOR_THEME so that cannot come back.
 */
describe('applyColorTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
  });

  it('applies the default theme by removing data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'fork-theme');

    applyColorTheme(DEFAULT_COLOR_THEME);

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('sets data-theme for a theme that is not the default', () => {
    // The package ships one theme today, so the type has no second member; a
    // fork that adds one widens ColorTheme and takes this path.
    const other = 'fork-theme' as ColorTheme;

    applyColorTheme(other);

    expect(document.documentElement.getAttribute('data-theme')).toBe(other);
  });

  it('switches from a non-default theme back to the default', () => {
    applyColorTheme('fork-theme' as ColorTheme);
    expect(document.documentElement.getAttribute('data-theme')).toBe('fork-theme');

    applyColorTheme(DEFAULT_COLOR_THEME);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('adds the dark class for the dark preference and drops it for light', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
