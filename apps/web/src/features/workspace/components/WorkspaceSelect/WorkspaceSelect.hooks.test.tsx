import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useWorkspaceSelect } from './WorkspaceSelect.hooks';

const { listFn } = vi.hoisted(() => ({
  listFn: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    workspaces: {
      list: {
        queryOptions: () => ({ queryKey: ['workspaces', 'list'], queryFn: () => listFn() }),
        queryKey: () => ['workspaces', 'list'],
      },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const workspaceRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'f-1',
  name: 'Northwind',
  legalName: null,
  street: null,
  postalCode: null,
  city: null,
  ...overrides,
});

const onChange = vi.fn();
const renderSubject = (value = '') =>
  renderHook(() => useWorkspaceSelect({ value, onChange }), { wrapper });

afterEach(() => vi.clearAllMocks());

describe('useWorkspaceSelect', () => {
  it('exposes the tenant workspaces once loaded', async () => {
    listFn.mockResolvedValue({ workspaces: [workspaceRow()] });
    const { result } = renderSubject();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.workspaces).toEqual([workspaceRow()]);
    expect(result.current.isEmpty).toBe(false);
  });

  it('reports an empty roster so the caller can prompt for the first workspace', async () => {
    listFn.mockResolvedValue({ workspaces: [] });
    const { result } = renderSubject();

    await waitFor(() => expect(result.current.isEmpty).toBe(true));
  });

  it('resolves the selected row from the list, so the edit dialog can seed from it', async () => {
    const selected = workspaceRow({ city: 'Springfield' });
    listFn.mockResolvedValue({ workspaces: [selected, workspaceRow({ id: 'f-2', name: 'Beta' })] });
    const { result } = renderSubject('f-1');

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.selectedWorkspace).toEqual(selected);
  });

  it('walks the dialog through create, edit and closed states', async () => {
    listFn.mockResolvedValue({ workspaces: [workspaceRow()] });
    const { result } = renderSubject('f-1');
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.dialogMode).toBeNull();
    act(() => result.current.onOpenCreate());
    expect(result.current.dialogMode).toBe('create');
    act(() => result.current.onDialogOpenChange(false));
    expect(result.current.dialogMode).toBeNull();
    act(() => result.current.onOpenEdit());
    expect(result.current.dialogMode).toBe('edit');
    act(() => result.current.onDialogOpenChange(false));
    expect(result.current.dialogMode).toBeNull();
  });

  it('selects a freshly saved workspace, so the user is not left re-picking', async () => {
    listFn.mockResolvedValue({ workspaces: [] });
    const { result } = renderSubject();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.onSaved(workspaceRow({ id: 'f-9', name: 'Acme' }) as never));
    expect(onChange).toHaveBeenCalledWith('f-9');
  });
});
