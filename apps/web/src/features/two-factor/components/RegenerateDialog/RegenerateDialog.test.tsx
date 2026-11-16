import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import RegenerateDialog from './RegenerateDialog';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    twoFactor: {
      regenerateRecoveryCodes: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      status: { queryOptions: () => ({ queryKey: ['twoFactor.status'] }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('RegenerateDialog', () => {
  it('starts on the password step when opened', () => {
    renderWithClient(<RegenerateDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole('heading', { name: /regenerate recovery codes/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^regenerate$/i })).toBeInTheDocument();
  });
});
