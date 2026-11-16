import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import LoginForm from './LoginForm';

// LoginForm renders <Link> from @tanstack/react-router and the hook calls
// useNavigate / useSearch; stub the module so tests run without a router context.
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
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

// TurnstileField injects an external script and reads an env siteKey.
// Mock it to a no-op so the test stays fully offline.
vi.mock('@/features/auth/components/TurnstileField', () => ({
  TurnstileField: () => null,
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('LoginForm', () => {
  it('renders the email input', () => {
    renderWithClient(<LoginForm />);
    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeInTheDocument();
  });

  it('renders the sign in button', () => {
    renderWithClient(<LoginForm />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
