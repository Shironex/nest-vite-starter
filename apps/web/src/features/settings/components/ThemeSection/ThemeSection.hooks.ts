import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/ui-store';
import type { IThemeOption, IThemeSectionView } from './ThemeSection.types';

export function useThemeSection(): IThemeSectionView {
  const { t } = useTranslation();
  const { theme, setTheme } = useUIStore();

  const options: readonly IThemeOption[] = [
    {
      value: 'light',
      label: t('settings.theme.light'),
      description: t('settings.theme.lightDescription'),
    },
    {
      value: 'dark',
      label: t('settings.theme.dark'),
      description: t('settings.theme.darkDescription'),
    },
    {
      value: 'system',
      label: t('settings.theme.system'),
      description: t('settings.theme.systemDescription'),
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
