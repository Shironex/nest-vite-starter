import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { withThemeByClassName } from '@storybook/addon-themes';
import { I18nextProvider } from 'react-i18next';
import type { Decorator, Preview } from '@storybook/react-vite';
import { i18n, initI18n } from '../src/lib/i18n';
import './preview.css';

// A throwaway client per story session: queries never retry and never hit the
// network in stories, so component stories render without a tRPC backend.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const withQueryClient: Decorator = (Story) => (
  <QueryClientProvider client={queryClient}>
    <Story />
  </QueryClientProvider>
);

// Resources are bundled and init is synchronous (`initAsync: false`), so the
// instance is ready by the time the first story renders. Without this, any
// story for a translated component throws on the missing i18next context.
void initI18n();

const withI18n: Decorator = (Story) => (
  <I18nextProvider i18n={i18n}>
    <Story />
  </I18nextProvider>
);

const preview: Preview = {
  decorators: [
    withI18n,
    withQueryClient,
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
  ],
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
