import type { Meta, StoryObj } from '@storybook/react-vite';
import UserMenu from './UserMenu';

const meta: Meta<typeof UserMenu> = {
  title: 'layout/UserMenu',
  component: UserMenu,
};

export default meta;

type Story = StoryObj<typeof UserMenu>;

/** The avatar trigger renders once the signed-in profile resolves; the menu holds settings and logout. */
export const Default: Story = {};
