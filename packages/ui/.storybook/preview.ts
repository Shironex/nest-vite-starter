import type { Preview, Decorator } from '@storybook/react-vite';
import { withThemeByClassName } from '@storybook/addon-themes';
import { useEffect } from 'react';
import { COLOR_THEMES, DEFAULT_COLOR_THEME } from '../src/theme';
import './storybook.css';

/**
 * Custom decorator for color themes.
 * We can't use withThemeByDataAttribute because it shares the same
 * globals.theme key as withThemeByClassName, causing a crash when
 * switching themes (classStringToArray gets undefined).
 */
const withColorTheme: Decorator = (Story, context) => {
  const colorTheme: string = context.globals.colorTheme || DEFAULT_COLOR_THEME;

  useEffect(() => {
    const root = document.documentElement;
    if (colorTheme === DEFAULT_COLOR_THEME) {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', colorTheme);
    }
  }, [colorTheme]);

  return Story();
};

const preview: Preview = {
  decorators: [
    withThemeByClassName({
      themes: {
        light: '',
        dark: 'dark',
      },
      defaultTheme: 'light',
    }),
    withColorTheme,
  ],
  globalTypes: {
    colorTheme: {
      name: 'Color Theme',
      description: 'Switch the color palette',
      toolbar: {
        icon: 'paintbrush',
        items: COLOR_THEMES.map((theme) => ({ value: theme.id, title: theme.name })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    colorTheme: DEFAULT_COLOR_THEME,
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
