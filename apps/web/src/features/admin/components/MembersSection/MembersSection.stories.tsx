import type { Meta, StoryObj } from '@storybook/react-vite';
import MembersSection from './MembersSection';

const meta: Meta<typeof MembersSection> = {
  title: 'admin/MembersSection',
  component: MembersSection,
};

export default meta;

type Story = StoryObj<typeof MembersSection>;

/** Driven by user.listUsers; the global QueryClient decorator covers the query. */
export const Default: Story = {};
