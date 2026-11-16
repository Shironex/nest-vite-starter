import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import type { ConfirmPasswordInput } from '@repo/shared/schemas';
import ConfirmPasswordDialog from './ConfirmPasswordDialog';

const { view } = vi.hoisted(() => ({
  view: { current: { isPending: false, hasNoPassword: false, onSubmit: vi.fn() } },
}));

// The mutation, the error branching and the ordering contract live in the hook
// and are proven in ConfirmPasswordDialog.hooks.test.tsx; this file owns what
// the dialog draws. The factory builds a real form at render time so the
// @repo/ui Form plumbing has an actual react-hook-form instance behind it.
vi.mock('./ConfirmPasswordDialog.hooks', () => ({
  useConfirmPasswordDialog: () => {
    const form = useForm<ConfirmPasswordInput>({ defaultValues: { password: '' } });
    return { form, ...view.current };
  },
}));

// The set-a-password-first body links to the reset route; a bare anchor stands
// in for the router-bound Link so no RouterProvider is needed here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, className, children }: { to: string; className?: string; children?: ReactNode }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

describe('ConfirmPasswordDialog', () => {
  it('renders the password form with the localized sudo copy', () => {
    view.current = { isPending: false, hasNoPassword: false, onSubmit: vi.fn() };
    render(<ConfirmPasswordDialog open onOpenChange={vi.fn()} onConfirmed={vi.fn()} />);

    expect(screen.getByText('Confirm your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('closes from the cancel button without submitting', () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    view.current = { isPending: false, hasNoPassword: false, onSubmit };
    render(<ConfirmPasswordDialog open onOpenChange={onOpenChange} onConfirmed={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('replaces the form with the password-reset route for an OAuth-only account', () => {
    view.current = { isPending: false, hasNoPassword: true, onSubmit: vi.fn() };
    render(<ConfirmPasswordDialog open onOpenChange={vi.fn()} onConfirmed={vi.fn()} />);

    // No password field: retyping cannot succeed for a null-hash account.
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    const resetLink = screen.getByRole('link', { name: 'Go to password reset' });
    expect(resetLink).toHaveAttribute('href', '/auth/forgot-password');
  });

  it('renders nothing while closed', () => {
    view.current = { isPending: false, hasNoPassword: false, onSubmit: vi.fn() };
    render(<ConfirmPasswordDialog open={false} onOpenChange={vi.fn()} onConfirmed={vi.fn()} />);

    expect(screen.queryByText('Confirm your password')).not.toBeInTheDocument();
  });
});
