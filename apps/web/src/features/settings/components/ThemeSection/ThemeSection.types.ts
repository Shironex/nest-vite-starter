import type { ThemePreference } from '@/lib/theme';

export interface IThemeOption {
  readonly value: ThemePreference;
  readonly label: string;
  readonly description: string;
}

export interface IThemeSectionView {
  readonly theme: ThemePreference;
  readonly setTheme: (value: ThemePreference) => void;
  readonly options: readonly IThemeOption[];
  readonly activeDescription: string | undefined;
}
