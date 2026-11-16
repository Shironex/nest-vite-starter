import type { Meta, StoryObj } from '@storybook/react-vite';
import EnrollWizard from './EnrollWizard';

const meta: Meta<typeof EnrollWizard> = {
  title: 'two-factor/EnrollWizard',
  component: EnrollWizard,
};

export default meta;

type Story = StoryObj<typeof EnrollWizard>;

/** Opens on the password-confirmation step. */
export const Default: Story = {};
