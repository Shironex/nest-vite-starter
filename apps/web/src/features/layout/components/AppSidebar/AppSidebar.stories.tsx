import type { Meta, StoryObj } from '@storybook/react-vite';
import { SidebarProvider } from '@repo/ui/sidebar';
import AppSidebar from './AppSidebar';

const meta: Meta<typeof AppSidebar> = {
  title: 'layout/AppSidebar',
  component: AppSidebar,
  decorators: [
    (Story) => (
      <SidebarProvider>
        <Story />
      </SidebarProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof AppSidebar>;

/** Default state: renders the sidebar with nav items. Active item is determined by the router. */
export const Default: Story = {};
