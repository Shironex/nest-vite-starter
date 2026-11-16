import { useUIStore } from '@/stores/ui-store';
import type { IThemeOption, IThemeSectionView } from './ThemeSection.types';
import { settingsStrings } from '@/features/settings/Settings.strings';

export function useThemeSection(): IThemeSectionView {
  const { theme, setTheme } = useUIStore();

  const options: readonly IThemeOption[] = [
    {
      value: 'light',
      label: settingsStrings.theme.light,
      description: settingsStrings.theme.lightDescription,
    },
    {
      value: 'dark',
      label: settingsStrings.theme.dark,
      description: settingsStrings.theme.darkDescription,
    },
    {
      value: 'system',
      label: settingsStrings.theme.system,
      description: settingsStrings.theme.systemDescription,
    },
  ];
  const activeDescription = options.find((o) => o.value === theme)?.description;

  return {
    theme,
    setTheme,
    options,
    activeDescription,
  };
}
