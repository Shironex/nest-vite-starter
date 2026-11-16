import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import type { RequestEmailChangeInput } from '@repo/shared/schemas';
import EmailChangeSection from './EmailChangeSection';
import type { IEmailChangeSectionView } from './EmailChangeSection.types';

const { view } = vi.hoisted(() => ({
  view: { current: null as Omit<IEmailChangeSectionView, 'form'> | null },
}));

// Queries, the sudo retry machine and the error mapping live in the hook and
// are proven in EmailChangeSection.hooks.test.tsx; this file owns what the
// card draws for a given view.
vi.mock('./EmailChangeSection.hooks', () => ({
  useEmailChangeSection: () => {
    // Real form instance so <Form> and the field controllers behave; the
    // hoisted view cannot carry one because hooks only run inside components.
    const form = useForm<RequestEmailChangeInput>({
      defaultValues: { newEmail: '', factorCode: '' },
    });
    return { ...view.current, form };
  },
}));

// The dialog has its own tests and pulls in trpc; a marker stands in for it.
vi.mock('../ConfirmPasswordDialog', () => ({
  ConfirmPasswordDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="confirm-password-dialog" /> : null,
}));

const baseView = (
  overrides: Partial<Omit<IEmailChangeSectionView, 'form'>>,
): Omit<IEmailChangeSectionView, 'form'> => ({
  currentEmail: 'old@x.com',
  onSubmit: vi.fn(),
  isPending: false,
  requiresFactorCode: false,
  pendingSentTo: null,
  isDialogOpen: false,
  onDialogOpenChange: vi.fn(),
  onSudoConfirmed: vi.fn(),
  ...overrides,
});

describe('EmailChangeSection', () => {
  it('shows the current address and the new-address field', () => {
    view.current = baseView({});
    render(<EmailChangeSection />);

    expect(screen.getByText('Email address')).toBeInTheDocument();
    expect(screen.getByText('old@x.com')).toBeInTheDocument();
    expect(screen.getByLabelText('New email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change email address' })).toBeInTheDocument();
  });

  it('hides the 2FA code field until the account has an active factor', () => {
    view.current = baseView({});
    render(<EmailChangeSection />);
    expect(screen.queryByLabelText('Two-factor authentication code')).not.toBeInTheDocument();
  });

  it('collects a 2FA code when a factor is active', () => {
    view.current = baseView({ requiresFactorCode: true });
    render(<EmailChangeSection />);
    expect(screen.getByLabelText('Two-factor authentication code')).toBeInTheDocument();
  });

  it('announces where the confirmation link went after a successful request', () => {
    view.current = baseView({ pendingSentTo: 'new@x.com' });
    render(<EmailChangeSection />);
    expect(screen.getByRole('status')).toHaveTextContent('new@x.com');
  });

  it('disables the submit while the request is in flight', () => {
    view.current = baseView({ isPending: true });
    render(<EmailChangeSection />);
    expect(screen.getByRole('button', { name: 'Change email address' })).toBeDisabled();
  });

  it('mounts the sudo dialog only when the hook opens it', () => {
    view.current = baseView({ isDialogOpen: false });
    render(<EmailChangeSection />);
    expect(screen.queryByTestId('confirm-password-dialog')).not.toBeInTheDocument();

    view.current = baseView({ isDialogOpen: true });
    render(<EmailChangeSection />);
    expect(screen.getByTestId('confirm-password-dialog')).toBeInTheDocument();
  });

  it('submits through the hook callback', () => {
    const onSubmit = vi.fn();
    view.current = baseView({ onSubmit });
    render(<EmailChangeSection />);

    fireEvent.change(screen.getByLabelText('New email address'), {
      target: { value: 'new@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change email address' }));

    return waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ newEmail: 'new@x.com' }),
        expect.anything(),
      );
    });
  });
});
