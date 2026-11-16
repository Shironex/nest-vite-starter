import type { Meta, StoryObj } from '@storybook/react-vite';
import ConnectedAccountsSection from './ConnectedAccountsSection';

/**
 * Renders its loading line without an api behind the Storybook dev server
 * (`oauth.listAccounts` never answers there). The list, empty, error and
 * sudo-prompt states are pinned by ConnectedAccountsSection.test.tsx and the
 * hook behavior by ConnectedAccountsSection.hooks.test.tsx.
 */
const meta: Meta<typeof ConnectedAccountsSection> = {
  title: 'auth/ConnectedAccountsSection',
  component: ConnectedAccountsSection,
};

export default meta;

type Story = StoryObj<typeof ConnectedAccountsSection>;

export const Default: Story = {};
