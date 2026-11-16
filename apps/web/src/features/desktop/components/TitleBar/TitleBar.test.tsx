import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PRODUCT_NAME } from '@repo/shared/constants';
import TitleBar from './TitleBar';

// Stub the hook with a deterministic Electron-like view so the shell renders
// the control buttons rather than returning null.
vi.mock('./TitleBar.hooks', () => ({
  useTitleBar: () => ({
    isMaximized: false,
    isAuthenticated: false,
    isLoading: false,
    onMinimize: vi.fn(),
    onMaximize: vi.fn(),
    onClose: vi.fn(),
  }),
}));

// TitleBar renders <Link> from @tanstack/react-router when the hook returns a
// non-null view. Stub the module so tests run without a full router context.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

describe('TitleBar', () => {
  it('renders the Minimize button', () => {
    render(<TitleBar />);
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument();
  });

  it('renders the Maximize button when not maximized', () => {
    render(<TitleBar />);
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument();
  });

  it('renders the Close button', () => {
    render(<TitleBar />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders the app title link', () => {
    render(<TitleBar />);
    expect(screen.getByText(PRODUCT_NAME)).toBeInTheDocument();
  });
});
