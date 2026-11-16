import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ConnectionIndicator from './ConnectionIndicator';

describe('ConnectionIndicator', () => {
  it('announces the disconnected state via a focusable status region', () => {
    render(<ConnectionIndicator />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Connection status: Disconnected');
    expect(status).toHaveAttribute('tabindex', '0');
  });
});
