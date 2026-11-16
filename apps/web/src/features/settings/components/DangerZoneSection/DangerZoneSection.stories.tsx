import type { Meta, StoryObj } from '@storybook/react-vite';
import DangerZoneSection from './DangerZoneSection';

const meta: Meta<typeof DangerZoneSection> = {
  title: 'settings/DangerZoneSection',
  component: DangerZoneSection,
};

export default meta;

type Story = StoryObj<typeof DangerZoneSection>;

export const Default: Story = {};
