export type ColorTheme =
  'violet' | 'ocean' | 'forest' | 'amber' | 'rose' | 'lime' | 'slate' | 'starter';

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
