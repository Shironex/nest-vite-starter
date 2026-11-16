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
    id: 'violet',
    name: 'Violet',
    description: 'shadcn purple accent, clean and modern',
    previewColors: {
      light: { bg: 'oklch(1 0 0)', accent: 'oklch(0.541 0.281 293.009)' },
      dark: {
        bg: 'oklch(0.141 0.005 285.823)',
        accent: 'oklch(0.735 0.183 293.541)',
      },
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Calm, professional blue tones',
    previewColors: {
      light: { bg: 'oklch(0.97 0.01 230)', accent: 'oklch(0.55 0.2 230)' },
      dark: { bg: 'oklch(0.18 0.03 235)', accent: 'oklch(0.72 0.14 230)' },
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Natural, earthy green tones',
    previewColors: {
      light: { bg: 'oklch(0.97 0.02 150)', accent: 'oklch(0.55 0.17 155)' },
      dark: { bg: 'oklch(0.18 0.03 150)', accent: 'oklch(0.72 0.17 150)' },
    },
  },
  {
    id: 'amber',
    name: 'Amber',
    description: 'Warm, inviting amber and orange',
    previewColors: {
      light: { bg: 'oklch(0.97 0.02 85)', accent: 'oklch(0.65 0.18 65)' },
      dark: { bg: 'oklch(0.18 0.02 55)', accent: 'oklch(0.78 0.15 80)' },
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'Elegant pink and magenta accents',
    previewColors: {
      light: { bg: 'oklch(0.97 0.01 350)', accent: 'oklch(0.6 0.22 350)' },
      dark: { bg: 'oklch(0.18 0.03 340)', accent: 'oklch(0.75 0.16 350)' },
    },
  },
  {
    id: 'lime',
    name: 'Lime',
    description: 'Fresh and energetic chartreuse',
    previewColors: {
      light: { bg: 'oklch(0.97 0.03 130)', accent: 'oklch(0.7 0.2 130)' },
      dark: { bg: 'oklch(0.18 0.03 130)', accent: 'oklch(0.8 0.18 130)' },
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
