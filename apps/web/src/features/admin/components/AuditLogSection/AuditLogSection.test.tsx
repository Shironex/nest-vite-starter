import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuditLogSection from './AuditLogSection';

const { listFn } = vi.hoisted(() => ({ listFn: vi.fn() }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: {
      list: {
        queryOptions: (input?: unknown) => ({
          queryKey: ['audit', 'list', input],
          queryFn: () => listFn(input),
        }),
      },
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('AuditLogSection', () => {
  it('lists who did what to whom, with no filter controls', async () => {
    listFn.mockResolvedValue({
      items: [
        {
          id: 'a-1',
          action: 'user.account.disabled',
          actor: { id: 'u-1', email: 'alice@example.com', displayName: 'Alice' },
          targetType: 'User',
          targetId: 'u-2',
          success: true,
          createdAt: new Date('2026-01-02T10:30:00Z'),
        },
      ],
      nextCursor: null,
    });
    renderWithClient(<AuditLogSection />);

    expect(await screen.findByText('Account disabled by an administrator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('User (u-2)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says so when the trail is empty', async () => {
    listFn.mockResolvedValue({ items: [], nextCursor: null });
    renderWithClient(<AuditLogSection />);

    expect(await screen.findByText('The audit log is still empty')).toBeInTheDocument();
  });

  it('offers a retry when the read fails', async () => {
    listFn.mockRejectedValue(new Error('nope'));
    renderWithClient(<AuditLogSection />);

    expect(await screen.findByText('Could not load the audit log')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
