import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { Form } from '@repo/ui/form';
import AuthField from './AuthField';
import type { IAuthFieldProps } from './AuthField.types';

interface ITestValues {
  email: string;
}

type HarnessProps = Omit<IAuthFieldProps<ITestValues>, 'form'> & {
  readonly errorMessage?: string;
};

function Harness({ errorMessage, ...fieldProps }: HarnessProps) {
  const form = useForm<ITestValues>({ defaultValues: { email: '' } });

  if (errorMessage !== undefined) {
    form.setError('email', { type: 'manual', message: errorMessage });
  }

  return (
    <Form {...form}>
      <AuthField<ITestValues> form={form} {...fieldProps} />
    </Form>
  );
}

describe('AuthField', () => {
  it('binds the label to the input so clicking the label focuses it', () => {
    render(<Harness name="email" label="Email address" type="email" />);

    // getByLabelText only resolves through a real label/control association.
    expect(screen.getByLabelText('Email address')).toBeInstanceOf(HTMLInputElement);
  });

  it('forwards the input attributes it is given', () => {
    render(
      <Harness
        name="email"
        label="Email address"
        type="email"
        placeholder="anna@example.com"
        autoComplete="email"
      />,
    );

    const input = screen.getByLabelText('Email address');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('placeholder', 'anna@example.com');
    expect(input).toHaveAttribute('autocomplete', 'email');
  });

  it('renders a label action next to the label', () => {
    render(
      <Harness
        name="email"
        label="Password"
        labelAction={<a href="/auth/forgot-password">Forgot password?</a>}
      />,
    );

    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
  });

  it('renders children under the input', () => {
    render(
      <Harness name="email" label="Password">
        <p>Password strength meter</p>
      </Harness>,
    );

    expect(screen.getByText('Password strength meter')).toBeInTheDocument();
  });

  it('associates a validation message with the input and marks it invalid', () => {
    render(<Harness name="email" label="Email address" errorMessage="Invalid email." />);

    const input = screen.getByLabelText('Email address');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The message must be reachable from the input, not merely rendered nearby.
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByText('Invalid email.').id);
  });
});
