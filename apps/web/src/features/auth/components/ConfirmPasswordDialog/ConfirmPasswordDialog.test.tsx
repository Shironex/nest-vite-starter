import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import type { ConfirmPasswordInput } from '@repo/shared/schemas';
import ConfirmPasswordDialog from './ConfirmPasswordDialog';

const { view } = vi.hoisted(() => ({
  view: { current: { isPending: false, onSubmit: vi.fn() } },
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

describe('ConfirmPasswordDialog', () => {
  it('renders the password form with the localized sudo copy', () => {
    view.current = { isPending: false, onSubmit: vi.fn() };
    render(<ConfirmPasswordDialog open onOpenChange={vi.fn()} onConfirmed={vi.fn()} />);

    expect(screen.getByText('Confirm your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('closes from the cancel button without submitting', () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    view.current = { isPending: false, onSubmit };
    render(<ConfirmPasswordDialog open onOpenChange={onOpenChange} onConfirmed={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    view.current = { isPending: false, onSubmit: vi.fn() };
    render(<ConfirmPasswordDialog open={false} onOpenChange={vi.fn()} onConfirmed={vi.fn()} />);

    expect(screen.queryByText('Confirm your password')).not.toBeInTheDocument();
  });
});
