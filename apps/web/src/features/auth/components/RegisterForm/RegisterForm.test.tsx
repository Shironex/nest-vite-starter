import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegisterForm from './RegisterForm';

// Stub @tanstack/react-router so tests run without a full router context.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
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

// Stub @/lib/trpc so no network is needed in tests.
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      register: {
        mutationOptions: () => ({}),
      },
    },
  },
  resetCsrfToken: () => undefined,
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('RegisterForm', () => {
  /*
   * This suite renders the REAL TurnstileField (unlike the login suite, which
   * stubs it), so the widget mounts, reports that it has no token yet, and the
   * submit sits in its gated state. That is the contract worth pinning: the
   * form must never present a live-looking button while a submit would be
   * refused by validation with nothing on screen to explain it.
   */
  it('holds the submit closed and named while the captcha has no token', () => {
    renderWithClient(<RegisterForm />);
    const submit = screen.getByRole('button', { name: /Running security check/ });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the email field', () => {
    renderWithClient(<RegisterForm />);
    expect(screen.getByLabelText('Work email address')).toBeInTheDocument();
  });
});
