import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOrganizationIdentity } from './OrganizationIdentity.hooks';

const { tenantFn } = vi.hoisted(() => ({ tenantFn: vi.fn() }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    user: {
      tenant: {
        queryOptions: () => ({ queryKey: ['user', 'tenant'], queryFn: () => tenantFn() }),
      },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useOrganizationIdentity', () => {
  it('reports pending until the query resolves', () => {
    tenantFn.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useOrganizationIdentity(), { wrapper });
    expect(result.current).toEqual({ status: 'pending' });
  });

  it('derives the name and two-letter initials from the organization name', async () => {
    tenantFn.mockResolvedValue({ name: 'Acme Robotics' });
    const { result } = renderHook(() => useOrganizationIdentity(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({
      status: 'ready',
      name: 'Acme Robotics',
      initial: 'AR',
    });
  });

  it('falls back to a translated placeholder when the organization has no name', async () => {
    tenantFn.mockResolvedValue({ name: null });
    const { result } = renderHook(() => useOrganizationIdentity(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', name: 'Your organization', initial: 'YO' });
  });

  // A failed lookup must still name the footer, never leave it empty.
  it('falls back to the translated placeholder when the lookup fails', async () => {
    tenantFn.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useOrganizationIdentity(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toEqual({ status: 'error', name: 'Your organization', initial: 'YO' });
  });
});
