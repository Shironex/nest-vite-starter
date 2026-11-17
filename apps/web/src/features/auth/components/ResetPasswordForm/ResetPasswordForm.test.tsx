import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import ResetPasswordForm from './ResetPasswordForm';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

let requiresTwoFactor = false;
let isTokenMissing = false;

// Stub the hook so the test needs no router context or tRPC client.
vi.mock('./ResetPasswordForm.hooks', () => ({
  useResetPasswordForm: () => {
    const form = useForm({ defaultValues: { token: 't', password: '', factorCode: '' } });
    return {
      form,
      onSubmit: vi.fn(),
      serverError: null,
      isPending: false,
      password: '',
      showRequestNewLink: false,
      requiresTwoFactor,
      isTokenMissing,
    };
  },
}));

describe('ResetPasswordForm', () => {
  it('renders the new-password field and submit button', () => {
    requiresTwoFactor = false;
    isTokenMissing = false;
    render(<ResetPasswordForm />);
    expect(screen.getByPlaceholderText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Authenticator code or backup code')).not.toBeInTheDocument();
  });

  it('shows the second-factor code field when the account requires 2FA', () => {
    requiresTwoFactor = true;
    render(<ResetPasswordForm />);
    expect(screen.getByLabelText('Authenticator code or backup code')).toBeInTheDocument();
  });

  /**
   * `token` is optional in the route search on purpose: a thrown
   * `validateSearch` is surfaced by TanStack as a route error, so requiring it
   * answers a mail client that rewrote the link without its query with a red
   * error card instead of the sentence telling the reader where the real link
   * is. This asserts the sentence.
   */
  it('replaces the form with in-page copy when the link carries no token', () => {
    requiresTwoFactor = false;
    isTokenMissing = true;
    render(<ResetPasswordForm />);

    expect(screen.getByRole('alert')).toHaveTextContent('Open the password reset link');
    expect(screen.queryByPlaceholderText('At least 8 characters')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save and sign in' })).not.toBeInTheDocument();
    // The remedy differs from a spent token: ask for a fresh link.
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });
});
