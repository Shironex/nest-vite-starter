import type { Meta, StoryObj } from '@storybook/react-vite';
import OrganizationIdentity from './OrganizationIdentity';

const meta: Meta<typeof OrganizationIdentity> = {
  title: 'layout/OrganizationIdentity',
  component: OrganizationIdentity,
};

export default meta;

type Story = StoryObj<typeof OrganizationIdentity>;

/** The tenant's name and initials render once `user.tenant` resolves. */
export const Default: Story = {};
