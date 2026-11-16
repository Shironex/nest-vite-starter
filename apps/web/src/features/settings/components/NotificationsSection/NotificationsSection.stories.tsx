import type { Meta, StoryObj } from '@storybook/react-vite';
import NotificationsSection from './NotificationsSection';

const meta: Meta<typeof NotificationsSection> = {
  title: 'settings/NotificationsSection',
  component: NotificationsSection,
};

export default meta;

type Story = StoryObj<typeof NotificationsSection>;

/**
 * The panel hydrates from `notifications.preferencesGet` (the global
 * QueryClientProvider decorator supplies the query infrastructure); offline in
 * Storybook the query never settles, so the loading skeleton is what shows.
 */
export const Default: Story = {};
