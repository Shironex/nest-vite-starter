import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthSubmit from './AuthSubmit';

describe('AuthSubmit', () => {
  it('is a plain enabled submit when no captcha reports in', () => {
    render(<AuthSubmit isPending={false}>Sign in</AuthSubmit>);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // The defect this component exists for: a click between paint and the
  // Turnstile token landing produced no request and no feedback at all.
  it('closes and explains itself while the captcha is still working', () => {
    render(
      <AuthSubmit isPending={false} captchaStatus="pending">
        Sign in
      </AuthSubmit>,
    );
    expect(screen.getByRole('button', { name: /Running security check/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/We are checking/);
  });

  it('keeps the action name but refuses the click when the captcha failed', () => {
    render(
      <AuthSubmit isPending={false} captchaStatus="error">
        Sign in
      </AuthSubmit>,
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/security check failed/);
  });

  it('says the verification expired rather than failing silently', () => {
    render(
      <AuthSubmit isPending={false} captchaStatus="expired">
        Sign in
      </AuthSubmit>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/security check expired/);
  });

  it('stays disabled and busy while the submit is in flight', () => {
    render(
      <AuthSubmit isPending captchaStatus="ready">
        Sign in
      </AuthSubmit>,
    );
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
