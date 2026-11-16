import { Sun, Moon, Monitor } from 'lucide-react';
import { COLOR_THEMES } from '../theme/constants';
import type { ColorTheme, ThemeMode, IColorThemeDefinition } from '../theme/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { cn } from '../lib/utils';

interface IThemeSelectorProps {
  colorTheme: ColorTheme;
  mode: ThemeMode;
  onColorThemeChange: (theme: ColorTheme) => void;
  onModeChange: (mode: ThemeMode) => void;
  themes?: IColorThemeDefinition[];
  className?: string;
}

function ThemeSwatches({
  theme,
  size = 'sm',
}: {
  theme: IColorThemeDefinition;
  size?: 'sm' | 'md';
}) {
  const s = size === 'sm' ? 'size-3' : 'size-4';
  return (
    <span className="flex items-center gap-1">
      <span
        className={cn(s, 'rounded-full border border-border')}
        style={{ backgroundColor: theme.previewColors.light.accent }}
      />
      <span
        className={cn(s, 'rounded-full border border-border')}
        style={{ backgroundColor: theme.previewColors.dark.accent }}
      />
    </span>
  );
}

const modeIcons = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

const modeOrder: ThemeMode[] = ['light', 'dark', 'system'];

function ThemeSelector({
  colorTheme,
  mode,
  onColorThemeChange,
  onModeChange,
  themes = COLOR_THEMES,
  className,
}: IThemeSelectorProps) {
  const currentTheme = themes.find((t) => t.id === colorTheme) ?? themes[0]!;

  const cycleModeIndex = modeOrder.indexOf(mode);
  const nextMode = modeOrder[(cycleModeIndex + 1) % modeOrder.length]!;
  const ModeIcon = modeIcons[mode];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select value={colorTheme} onValueChange={(v) => onColorThemeChange(v as ColorTheme)}>
        <SelectTrigger size="sm" className="w-[160px]">
          <SelectValue>
            <ThemeSwatches theme={currentTheme} />
            <span>{currentTheme.name}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {themes.map((theme) => (
            <SelectItem key={theme.id} value={theme.id}>
              <ThemeSwatches theme={theme} />
              <span>{theme.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={() => onModeChange(nextMode)}
        className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-transparent text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        title={`Switch to ${nextMode} mode`}
        aria-label={`Switch to ${nextMode} mode`}
      >
        <ModeIcon className="size-4" />
      </button>
    </div>
  );
}

export { ThemeSelector, type IThemeSelectorProps };
