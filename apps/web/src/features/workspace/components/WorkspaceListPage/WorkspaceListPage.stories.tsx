import type { Meta, StoryObj } from '@storybook/react-vite';
import WorkspaceListPage from './WorkspaceListPage';

const meta: Meta<typeof WorkspaceListPage> = {
  title: 'workspace/WorkspaceListPage',
  component: WorkspaceListPage,
};

export default meta;

type Story = StoryObj<typeof WorkspaceListPage>;

/** The screen as it mounts: the list loads from `workspaces.list`. */
export const Default: Story = {};
