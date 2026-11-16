import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import ForgotPasswordForm from './ForgotPasswordForm';

// Stub router Link so tests run without a full router context.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// Stub TurnstileField to avoid CF widget + env key in tests.
vi.mock('@/features/auth/components/TurnstileField', () => ({
  TurnstileField: () => null,
}));

const state = vi.hoisted(() => ({
  submitted: false,
}));

// Stub the hook so no QueryClient, tRPC client, or network is needed.
vi.mock('./ForgotPasswordForm.hooks', () => ({
  useForgotPasswordForm: () => {
    const form = useForm({ defaultValues: { email: '', turnstileToken: '' } });
    return {
      form,
      onSubmit: vi.fn(),
      submitted: state.submitted,
      serverError: null,
      isPending: false,
      confirmationRef: { current: null },
    };
  },
}));

describe('ForgotPasswordForm', () => {
  it('renders the email input', () => {
    state.submitted = false;
    render(<ForgotPasswordForm />);
    expect(screen.getByPlaceholderText('anna@example.com')).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    state.submitted = false;
    render(<ForgotPasswordForm />);
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('announces the confirmation as a focusable status region after submit', () => {
    state.submitted = true;
    render(<ForgotPasswordForm />);
    const confirmation = screen.getByRole('status');
    expect(confirmation).toHaveTextContent(/If an account exists for this address/i);
    expect(confirmation).toHaveAttribute('tabindex', '-1');
    state.submitted = false;
  });
});
