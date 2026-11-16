import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import DisableDialog from './DisableDialog';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    twoFactor: {
      disable: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      status: { queryOptions: () => ({ queryKey: ['twoFactor.status'] }) },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('DisableDialog', () => {
  it('warns that recovery codes and trusted devices are lost when open', () => {
    renderWithClient(<DisableDialog open onOpenChange={() => {}} />);
    expect(
      screen.getByRole('heading', { name: /disable two-factor authentication/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /every recovery code is invalidated and every trusted browser is forgotten/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithClient(<DisableDialog open={false} onOpenChange={() => {}} />);
    expect(
      screen.queryByRole('heading', { name: /disable two-factor authentication/i }),
    ).not.toBeInTheDocument();
  });
});
