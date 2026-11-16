import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import VerifyEmail from './VerifyEmail';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// TurnstileField loads the Cloudflare script; stub it so the test stays offline.
vi.mock('@/features/auth/components/TurnstileField', () => ({
  TurnstileField: () => null,
}));

const state = vi.hoisted(() => ({
  token: undefined as string | undefined,
  emailSent: undefined as boolean | undefined,
  status: 'loading' as 'loading' | 'success' | 'error',
  retry: vi.fn(),
}));

// Stub the hooks so the test needs no router context or tRPC client.
vi.mock('./VerifyEmail.hooks', () => ({
  useVerifyEmail: () => ({ token: state.token, emailSent: state.emailSent }),
  useVerifyWithToken: () => ({
    status: state.status,
    errorMessage: null,
    retry: state.retry,
  }),
  useCheckYourEmail: () => {
    const form = useForm({ defaultValues: { turnstileToken: '' } });
    return {
      form,
      onResend: vi.fn(),
      resendSuccess: false,
      serverError: null,
      isPending: false,
    };
  },
}));

describe('VerifyEmail', () => {
  it('shows the "check your email" prompt when there is no token', () => {
    state.token = undefined;
    state.emailSent = undefined;
    render(<VerifyEmail />);
    expect(screen.getByRole('heading', { name: 'Confirm your email address' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend the link' })).toBeInTheDocument();
  });

  it('points at resend when the verification email could not be sent', () => {
    state.token = undefined;
    state.emailSent = false;
    render(<VerifyEmail />);
    expect(
      screen.getByRole('heading', { name: 'We could not send the email' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Confirm your email address' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend the link' })).toBeInTheDocument();
  });

  it('confirms success when a token verifies', () => {
    state.token = 'tok';
    state.status = 'success';
    render(<VerifyEmail />);
    expect(screen.getByRole('heading', { name: 'Email address confirmed' })).toBeInTheDocument();
    // Verification ends every session, so the screen says so and offers
    // only the way back in, never a dashboard link that would bounce.
    expect(screen.getByText(/please sign in again/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/login');
    expect(screen.queryByRole('link', { name: 'Go to the dashboard' })).not.toBeInTheDocument();
  });

  it('offers retry and resend when verification fails', () => {
    state.token = 'tok';
    state.status = 'error';
    state.retry.mockClear();
    render(<VerifyEmail />);

    expect(screen.getByRole('heading', { name: 'Verification failed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resend the link' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.retry).toHaveBeenCalledTimes(1);
  });
});
