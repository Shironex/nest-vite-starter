import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { deleteAccountSchema } from '@repo/shared/schemas';
import type { DeleteAccountInput } from '@repo/shared/schemas';
import type { IDangerZoneSectionView } from './DangerZoneSection.types';

let mockIsDialogOpen = false;
let mockIsPending = false;

// Mock the hook so the shell renders offline with no network or router bootstrap.
vi.mock('./DangerZoneSection.hooks', () => ({
  useDangerZoneSection: (): IDangerZoneSectionView => {
    const form = useForm<DeleteAccountInput>({
      resolver: zodResolver(deleteAccountSchema),
      mode: 'onBlur',
      defaultValues: { password: '' },
    });
    return {
      form,
      onSubmit: () => undefined,
      isPending: mockIsPending,
      isDialogOpen: mockIsDialogOpen,
      onDialogOpenChange: () => undefined,
    };
  },
}));

import DangerZoneSection from './DangerZoneSection';

describe('DangerZoneSection', () => {
  it('renders the destructive card with the grace-window copy and the trigger button', () => {
    mockIsDialogOpen = false;
    mockIsPending = false;
    render(<DangerZoneSection />);
    // The card title and the trigger share the copy, so both are on screen.
    expect(screen.getAllByText('Delete account')).toHaveLength(2);
    expect(screen.getByText(/30-day grace window/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete account$/i })).toBeInTheDocument();
  });

  it('renders the confirmation dialog with a password field when open', () => {
    mockIsDialogOpen = true;
    mockIsPending = false;
    render(<DangerZoneSection />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('disables the confirm button while the deletion is pending', () => {
    mockIsDialogOpen = true;
    mockIsPending = true;
    render(<DangerZoneSection />);
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('marks the cancel button type="button" so it cannot submit the surrounding form', () => {
    mockIsDialogOpen = true;
    mockIsPending = false;
    render(<DangerZoneSection />);
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveAttribute('type', 'button');
  });
});
