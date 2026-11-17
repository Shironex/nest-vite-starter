import { describe, it, expect, beforeEach } from 'vitest';
import { COLOR_THEMES, DEFAULT_COLOR_THEME } from '@repo/ui/theme';
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
    document.documentElement.setAttribute('data-theme', 'slate');

    applyColorTheme(DEFAULT_COLOR_THEME);

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('sets data-theme for every non-default theme', () => {
    const nonDefault = COLOR_THEMES.map((theme) => theme.id).filter(
      (id) => id !== DEFAULT_COLOR_THEME,
    );

    // Guards the list itself: if someone deletes every other theme the loop
    // below would vacuously pass.
    expect(nonDefault.length).toBeGreaterThan(0);
    expect(nonDefault).toContain('slate');

    for (const id of nonDefault) {
      applyColorTheme(id);
      expect(document.documentElement.getAttribute('data-theme')).toBe(id);
    }
  });

  it('switches from a non-default theme back to the default', () => {
    applyColorTheme('slate');
    expect(document.documentElement.getAttribute('data-theme')).toBe('slate');

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
