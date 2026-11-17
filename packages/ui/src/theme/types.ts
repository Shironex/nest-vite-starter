/**
 * The shipped color themes: `starter` (the indigo accent, the default) and
 * `slate` (neutral). A theme is a `[data-theme='<id>']` block plus its `.dark`
 * twin in styles/globals.css and an entry in COLOR_THEMES; add all three
 * together.
 */
export type ColorTheme = 'starter' | 'slate';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface IThemePreviewColors {
  light: { bg: string; accent: string };
  dark: { bg: string; accent: string };
}

export interface IColorThemeDefinition {
  id: ColorTheme;
  name: string;
  description: string;
  previewColors: IThemePreviewColors;
}
