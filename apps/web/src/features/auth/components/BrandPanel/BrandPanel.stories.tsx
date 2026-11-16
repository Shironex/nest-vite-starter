import type { Meta, StoryObj } from '@storybook/react-vite';
import BrandPanel from './BrandPanel';

const meta: Meta<typeof BrandPanel> = {
  title: 'auth/BrandPanel',
  component: BrandPanel,
  parameters: {
    // The panel only renders from the `lg` breakpoint up, matching the design.
    viewport: { defaultViewport: 'desktop' },
  },
};

export default meta;

type Story = StoryObj<typeof BrandPanel>;

export const Default: Story = {};
