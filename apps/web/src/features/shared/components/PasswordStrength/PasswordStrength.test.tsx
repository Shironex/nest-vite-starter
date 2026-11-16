import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PasswordStrength from './PasswordStrength';

describe('PasswordStrength', () => {
  it('lists every requirement', () => {
    render(<PasswordStrength password="" />);
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Special character')).toBeInTheDocument();
  });

  it('marks a requirement met once the password satisfies it', () => {
    render(<PasswordStrength password="abcdefgh" />);
    const lengthReq = screen.getByText('At least 8 characters');
    expect(lengthReq).toHaveClass('text-success');
  });
});
