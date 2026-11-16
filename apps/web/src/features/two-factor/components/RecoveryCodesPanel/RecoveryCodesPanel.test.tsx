import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RecoveryCodesPanel from './RecoveryCodesPanel';

const CODES = ['A1B2-C3D4-E5F6-G7H8', 'J9K0-L1M2-N3P4-Q5R6'];

describe('RecoveryCodesPanel', () => {
  it('renders every code', () => {
    render(<RecoveryCodesPanel codes={CODES} />);
    for (const code of CODES) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it('offers copy and download actions', () => {
    render(<RecoveryCodesPanel codes={CODES} />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
  });
});
