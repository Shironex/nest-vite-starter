import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema } from '@repo/shared/schemas';
import type { ChangePasswordInput } from '@repo/shared/schemas';
import type { IPasswordSectionView } from './PasswordSection.types';

// Mock the hook so the shell renders offline with no network.
vi.mock('./PasswordSection.hooks', () => ({
  usePasswordSection: (): IPasswordSectionView => {
    const form = useForm<ChangePasswordInput>({
      resolver: zodResolver(changePasswordSchema),
      mode: 'onBlur',
      defaultValues: { currentPassword: '', newPassword: '' },
    });
    return {
      form,
      onSubmit: () => undefined,
      isPending: false,
      newPassword: '',
    };
  },
}));

import PasswordSection from './PasswordSection';

describe('PasswordSection', () => {
  it('renders the current password field', () => {
    render(<PasswordSection />);
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    render(<PasswordSection />);
    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  });
});
