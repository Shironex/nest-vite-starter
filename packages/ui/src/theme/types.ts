/**
 * The shipped color theme: `starter` (the indigo accent, the default). The theme
 * engine stays so a fork can add its own: a theme is a `[data-theme='<id>']`
 * block plus its `.dark` twin in styles/globals.css, an entry in COLOR_THEMES and
 * a new member of this union; add all three together. A new theme must override
 * the whole token set, not only the shadcn semantic layer: the `--brand*`,
 * `--bg-app`, `--surface*`, `--text-*` and status tokens too, or the app keeps
 * the starter's look. Cover it in `pnpm check:contrast`.
 */
export type ColorTheme = 'starter';

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
