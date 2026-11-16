import type { Meta, StoryObj } from '@storybook/react-vite';
import { SidebarProvider } from '@repo/ui/sidebar';
import AppTopbar from './AppTopbar';

const meta: Meta<typeof AppTopbar> = {
  title: 'layout/AppTopbar',
  component: AppTopbar,
  decorators: [
    (Story) => (
      <SidebarProvider>
        <Story />
      </SidebarProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof AppTopbar>;

/** The title tracks the active route; the right cluster holds connection status, notifications and the user menu. */
export const Default: Story = {};
