import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmEmailChange from './ConfirmEmailChange';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const state = vi.hoisted(() => ({
  status: 'loading' as 'loading' | 'success' | 'error',
  errorMessage: null as string | null,
  retry: vi.fn(),
}));

// The mutation and its once-per-token trigger live in the hook; this file
// owns what each state draws.
vi.mock('./ConfirmEmailChange.hooks', () => ({
  useConfirmEmailChange: () => ({
    status: state.status,
    errorMessage: state.errorMessage,
    retry: state.retry,
  }),
}));

describe('ConfirmEmailChange', () => {
  it('explains an incomplete link when there is no token, without confirming anything', () => {
    render(<ConfirmEmailChange token={undefined} />);
    expect(screen.getByRole('heading', { name: 'Confirmation failed' })).toBeInTheDocument();
    expect(screen.getByText(/link is incomplete/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();
  });

  it('shows the in-progress state while the token confirms', () => {
    state.status = 'loading';
    render(<ConfirmEmailChange token="tok" />);
    expect(
      screen.getByRole('heading', { name: 'Confirming your new address' }),
    ).toBeInTheDocument();
  });

  it('on success says every session is out and routes to sign-in', () => {
    state.status = 'success';
    render(<ConfirmEmailChange token="tok" />);
    expect(screen.getByRole('heading', { name: 'Email address changed' })).toBeInTheDocument();
    expect(screen.getByText(/signed out everywhere/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();
  });

  it('on failure shows the hook-mapped message and offers retry', () => {
    state.status = 'error';
    state.errorMessage = 'This confirmation link is invalid or has expired.';
    state.retry.mockClear();
    render(<ConfirmEmailChange token="tok" />);

    expect(screen.getByRole('heading', { name: 'Confirmation failed' })).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.retry).toHaveBeenCalledTimes(1);
  });
});
