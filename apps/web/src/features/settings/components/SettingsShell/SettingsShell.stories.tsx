import type { Meta, StoryObj } from '@storybook/react-vite';
import { Shield, User, Users } from 'lucide-react';
import SettingsShell from './SettingsShell';

const meta: Meta<typeof SettingsShell> = {
  title: 'settings/SettingsShell',
  component: SettingsShell,
};

export default meta;

type Story = StoryObj<typeof SettingsShell>;

export const Default: Story = {
  args: {
    sections: [
      { id: 'profile', label: 'Profile', icon: User, panel: <p>Profile panel</p> },
      { id: 'security', label: 'Security', icon: Shield, panel: <p>Security panel</p> },
      { id: 'members', label: 'Members', icon: Users, panel: <p>Members panel</p> },
    ],
  },
};

/** One row only: the rail still renders, so the shell never looks half-built. */
export const SingleSection: Story = {
  args: {
    sections: [{ id: 'profile', label: 'Profile', icon: User, panel: <p>Profile panel</p> }],
  },
};
