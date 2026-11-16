import type { Meta, StoryObj } from '@storybook/react-vite';
import EmailChangeSection from './EmailChangeSection';

const meta: Meta<typeof EmailChangeSection> = {
  title: 'auth/EmailChangeSection',
  component: EmailChangeSection,
};

export default meta;

type Story = StoryObj<typeof EmailChangeSection>;

export const Default: Story = {};
