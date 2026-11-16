import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/select';
import type { ThemePreference } from '@/lib/theme';
import { useThemeSection } from './ThemeSection.hooks';

export default function ThemeSection() {
  const { t } = useTranslation();
  const { theme, setTheme, options, activeDescription } = useThemeSection();

  const optionItems = options.map((option) => (
    <SelectItem key={option.value} value={option.value}>
      {option.label}
    </SelectItem>
  ));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.theme.title')}</CardTitle>
        <CardDescription>{t('settings.theme.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <label id="theme-label" htmlFor="theme-trigger" className="type-body-medium text-text">
            {t('settings.theme.label')}
          </label>
          <Select value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
            <SelectTrigger id="theme-trigger" aria-labelledby="theme-label" className="w-[200px]">
              <SelectValue placeholder={t('settings.theme.placeholder')} />
            </SelectTrigger>
            <SelectContent>{optionItems}</SelectContent>
          </Select>
          <p className="type-label-caption text-text-muted">{activeDescription}</p>
        </div>
      </CardContent>
    </Card>
  );
}
