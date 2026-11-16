import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import EnrollWizard from './EnrollWizard';

vi.mock('@/lib/trpc', () => ({
  trpc: {
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

describe('EnrollWizard', () => {
  it('starts on the password-confirmation step', () => {
    renderWithClient(<EnrollWizard />);
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });
});
