import type { ColorTheme, IColorThemeDefinition } from './types';

/**
 * The theme that renders when no `data-theme` attribute is present on the
 * document root. Consumers should seed their theme store with this and treat it
 * as the sentinel that means "remove the attribute".
 */
export const DEFAULT_COLOR_THEME: ColorTheme = 'starter';

export const COLOR_THEMES: IColorThemeDefinition[] = [
  {
    id: 'starter',
    name: 'SaaS Starter',
    description: 'SaaS Starter brand palette, indigo on cool neutrals',
    previewColors: {
      light: { bg: 'oklch(0.9819 0.0029 264.54)', accent: 'oklch(0.5025 0.2134 268.41)' },
      dark: {
        bg: 'oklch(0.1738 0.0129 270.57)',
        accent: 'oklch(0.5731 0.2 270.66)',
      },
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Minimal, desaturated and professional',
    previewColors: {
      light: { bg: 'oklch(0.97 0.005 260)', accent: 'oklch(0.5 0.04 260)' },
      dark: { bg: 'oklch(0.18 0.01 260)', accent: 'oklch(0.7 0.03 260)' },
    },
  },
];
