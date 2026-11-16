import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { Form } from '@repo/ui/form';
import AuthField from './AuthField';

interface IDemoValues {
  email: string;
}

function AuthFieldDemo(props: Omit<React.ComponentProps<typeof AuthField<IDemoValues>>, 'form'>) {
  const form = useForm<IDemoValues>({ defaultValues: { email: '' } });

  return (
    <Form {...form}>
      <div className="w-100">
        <AuthField<IDemoValues> form={form} {...props} />
      </div>
    </Form>
  );
}

const meta: Meta<typeof AuthFieldDemo> = {
  title: 'auth/AuthField',
  component: AuthFieldDemo,
};

export default meta;

type Story = StoryObj<typeof AuthFieldDemo>;

export const Default: Story = {
  args: {
    name: 'email',
    label: 'Email address',
    type: 'email',
    placeholder: 'anna@example.com',
  },
};

export const WithLabelAction: Story = {
  args: {
    name: 'email',
    label: 'Password',
    type: 'password',
    placeholder: '••••••••',
    labelAction: (
      <a href="/auth/forgot-password" className="type-label-caption font-medium text-brand-ink">
        Forgot password?
      </a>
    ),
  },
};
