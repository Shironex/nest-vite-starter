import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import EnrollOnlyScreen from './EnrollOnlyScreen';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { logout: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
    user: { me: { queryOptions: () => ({ queryKey: ['user.me'] }) } },
    twoFactor: {
      beginEnrollment: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      activate: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  },
  resetCsrfToken: vi.fn(),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('EnrollOnlyScreen', () => {
  it('renders the enrollment wizard and a sign-out button', () => {
    renderWithClient(<EnrollOnlyScreen />);
    expect(screen.getByText(/now requires two-factor authentication/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});
