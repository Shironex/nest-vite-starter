import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuthLayout from './AuthLayout';

// AuthLayout renders a <Link to="/"> from @tanstack/react-router.
// Stub the module so tests run without a full router context.
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

describe('AuthLayout', () => {
  it('renders the title when provided', () => {
    render(
      <AuthLayout title="Sign in" description="Enter your credentials.">
        <p>Form</p>
      </AuthLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <AuthLayout title="Sign in" description="Enter your credentials.">
        <p>Form</p>
      </AuthLayout>,
    );
    expect(screen.getByText('Enter your credentials.')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <AuthLayout>
        <p>Child content</p>
      </AuthLayout>,
    );
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('omits the header block when neither title nor description is given', () => {
    render(
      <AuthLayout>
        <p>Form only</p>
      </AuthLayout>,
    );
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });
});
