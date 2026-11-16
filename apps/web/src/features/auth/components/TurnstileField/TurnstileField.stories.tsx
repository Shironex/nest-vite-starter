import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import TurnstileField from './TurnstileField';

const meta: Meta<typeof TurnstileField> = {
  title: 'auth/TurnstileField',
  component: TurnstileField,
};

export default meta;

type Story = StoryObj<typeof TurnstileField>;

function TurnstileFieldHarness() {
  const form = useForm<{ turnstileToken: string }>();
  return <TurnstileField form={form} />;
}

export const Default: Story = {
  render: () => <TurnstileFieldHarness />,
};
