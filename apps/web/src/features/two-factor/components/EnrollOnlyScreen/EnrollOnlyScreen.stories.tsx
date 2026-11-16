import type { Meta, StoryObj } from '@storybook/react-vite';
import EnrollOnlyScreen from './EnrollOnlyScreen';

const meta: Meta<typeof EnrollOnlyScreen> = {
  title: 'two-factor/EnrollOnlyScreen',
  component: EnrollOnlyScreen,
};

export default meta;

type Story = StoryObj<typeof EnrollOnlyScreen>;

export const Default: Story = {};
