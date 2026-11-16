import { describe, it, expect, beforeEach } from 'vitest';
import { COLOR_THEMES, DEFAULT_COLOR_THEME } from '@repo/ui/theme';
import type { ColorTheme } from '@repo/ui/theme';
import { applyColorTheme, applyTheme } from './theme';

/**
 * applyColorTheme encodes one rule that is invisible in the types: the default
 * theme is the palette @repo/ui authors on bare `:root`, so it is applied by
 * REMOVING data-theme, and every other theme is applied by SETTING it.
 *
 * That rule used to be written as `if (theme === 'violet')`. When SaaS Starter took
 * over `:root`, the literal silently inverted its meaning: picking "Violet"
 * removed the attribute and therefore rendered SaaS Starter, while Violet became
 * unreachable from the picker. Nothing failed, the wrong palette just rendered.
 * These tests pin the rule to DEFAULT_COLOR_THEME so that cannot come back.
 */
describe('applyColorTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
  });

  it('applies the default theme by removing data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'ocean');

    applyColorTheme(DEFAULT_COLOR_THEME);

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('sets data-theme for every non-default theme, violet included', () => {
    const nonDefault = COLOR_THEMES.map((theme) => theme.id).filter(
      (id) => id !== DEFAULT_COLOR_THEME,
    );

    // Guards the list itself: if someone deletes every other theme the loop
    // below would vacuously pass.
    expect(nonDefault.length).toBeGreaterThan(0);
    expect(nonDefault).toContain('violet');

    for (const id of nonDefault) {
      applyColorTheme(id);
      expect(document.documentElement.getAttribute('data-theme')).toBe(id);
    }
  });

  it('renders violet as violet rather than as the default palette', () => {
    // The precise defect: 'violet' must not be treated as the bare-:root theme.
    applyColorTheme('violet' as ColorTheme);

    expect(document.documentElement.getAttribute('data-theme')).toBe('violet');
  });

  it('switches from a non-default theme back to the default', () => {
    applyColorTheme('forest' as ColorTheme);
    expect(document.documentElement.getAttribute('data-theme')).toBe('forest');

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
