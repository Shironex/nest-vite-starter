import type { Meta, StoryObj } from '@storybook/react-vite';
import DataExportSection from './DataExportSection';

const meta: Meta<typeof DataExportSection> = {
  title: 'settings/DataExportSection',
  component: DataExportSection,
};

export default meta;

type Story = StoryObj<typeof DataExportSection>;

export const Default: Story = {};
