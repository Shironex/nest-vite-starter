import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Workspace } from '@repo/shared/schemas';
import { useWorkspaceListPage } from './WorkspaceListPage.hooks';

const { listFn, role } = vi.hoisted(() => ({
  listFn: vi.fn(),
  role: { current: 'ADMIN' as string | null },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    workspaces: {
      list: {
        queryOptions: () => ({ queryKey: ['workspaces', 'list'], queryFn: () => listFn() }),
      },
    },
  },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: role.current === null ? null : { role: role.current } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const workspaceRow = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'f-1',
  name: 'Northwind',
  legalName: null,
  street: null,
  postalCode: null,
  city: null,
  ...overrides,
});

const renderSubject = () => renderHook(() => useWorkspaceListPage(), { wrapper });

afterEach(() => {
  vi.clearAllMocks();
  role.current = 'ADMIN';
});

describe('useWorkspaceListPage', () => {
  it('loads first, then shows every workspace with a display string per cell', async () => {
    listFn.mockResolvedValue({
      workspaces: [
        workspaceRow({
          legalName: 'Northwind Ltd',
          street: 'Main St 1',
          postalCode: '12345',
          city: 'Springfield',
        }),
      ],
    });
    const { result } = renderSubject();
    expect(result.current.state).toBe('loading');

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.rows[0]).toMatchObject({
      name: 'Northwind',
      legalName: 'Northwind Ltd',
      address: 'Main St 1, 12345 Springfield',
      editLabel: 'Edit workspace Northwind',
    });
    expect(result.current.summary).toBe('Showing 1 of 1');
  });

  it('does not repeat a legal name identical to the working name', async () => {
    listFn.mockResolvedValue({ workspaces: [workspaceRow({ legalName: 'Northwind' })] });
    const { result } = renderSubject();

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.rows[0]?.legalName).toBeNull();
    expect(result.current.rows[0]?.address).toBe('-');
  });

  it('narrows by name or city', async () => {
    listFn.mockResolvedValue({
      workspaces: [
        workspaceRow({ id: 'f-1', name: 'Northwind', city: 'Springfield' }),
        workspaceRow({ id: 'f-2', name: 'Bravo', city: 'Shelbyville' }),
      ],
    });
    const { result } = renderSubject();
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onSearchChange('brav'));
    expect(result.current.rows.map((row) => row.id)).toEqual(['f-2']);
    expect(result.current.summary).toBe('Showing 1 of 2');

    act(() => result.current.onSearchChange('SPRING'));
    expect(result.current.rows.map((row) => row.id)).toEqual(['f-1']);

    act(() => result.current.onSearchChange('shelby'));
    expect(result.current.rows.map((row) => row.id)).toEqual(['f-2']);
  });

  it('tells a filtered empty list apart from an organization with no workspaces', async () => {
    listFn.mockResolvedValue({ workspaces: [workspaceRow()] });
    const { result } = renderSubject();
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onSearchChange('zzz'));
    expect(result.current.state).toBe('empty');
    expect(result.current.labels.emptyTitle).toBe('No matching workspaces');
  });

  it('points an ADMIN at the add button and a USER at their administrator', async () => {
    listFn.mockResolvedValue({ workspaces: [] });
    const admin = renderSubject();
    await waitFor(() => expect(admin.result.current.state).toBe('empty'));
    expect(admin.result.current.canManage).toBe(true);
    expect(admin.result.current.labels.emptyHint).toContain('Add the first workspace');

    role.current = 'USER';
    const member = renderSubject();
    await waitFor(() => expect(member.result.current.state).toBe('empty'));
    expect(member.result.current.canManage).toBe(false);
    expect(member.result.current.labels.emptyHint).toBe(
      'An organization administrator adds workspaces.',
    );
  });

  it('opens create blank and edit seeded with the row, and clears both on close', async () => {
    const northwind = workspaceRow();
    listFn.mockResolvedValue({ workspaces: [northwind] });
    const { result } = renderSubject();
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onOpenEdit(northwind));
    expect(result.current.dialogMode).toBe('edit');
    expect(result.current.editing).toBe(northwind);

    act(() => result.current.onDialogOpenChange(false));
    expect(result.current.dialogMode).toBeNull();
    expect(result.current.editing).toBeUndefined();

    act(() => result.current.onOpenCreate());
    expect(result.current.dialogMode).toBe('create');
    expect(result.current.editing).toBeUndefined();
  });

  it('reports a failed load and refetches on retry', async () => {
    listFn.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderSubject();
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.summary).toBeNull();

    listFn.mockResolvedValue({ workspaces: [workspaceRow()] });
    act(() => result.current.onRetry());
    await waitFor(() => expect(result.current.state).toBe('ready'));
  });
});
