import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Workspace } from '@repo/shared/schemas';
import { useWorkspaceFormDialog } from './WorkspaceFormDialog.hooks';
import type { IWorkspaceFormDialogProps } from './WorkspaceFormDialog.types';

const { createFn, updateFn, invalidateQueries, toastSuccess } = vi.hoisted(() => ({
  createFn: vi.fn(),
  updateFn: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@/lib/trpc', () => ({
  queryClient: { invalidateQueries },
  trpc: {
    workspaces: {
      list: { queryKey: () => ['workspaces', 'list'], pathKey: () => ['workspaces', 'list'] },
      create: {
        mutationOptions: (opts?: object) => ({ mutationFn: createFn, ...opts }),
      },
      update: {
        mutationOptions: (opts?: object) => ({ mutationFn: updateFn, ...opts }),
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

const savedRow: Workspace = {
  id: 'f-9',
  name: 'Acme',
  legalName: null,
  street: null,
  postalCode: null,
  city: null,
};

const existing: Workspace = {
  id: 'f-1',
  name: 'Northwind',
  legalName: 'Northwind Traders Limited',
  street: 'Main St 1',
  postalCode: '12345',
  city: 'Springfield',
};

const onOpenChange = vi.fn();
const onSaved = vi.fn();

const renderSubject = (props: Partial<IWorkspaceFormDialogProps> = {}) =>
  renderHook(
    () =>
      useWorkspaceFormDialog({
        open: true,
        onOpenChange,
        mode: 'create',
        onSaved,
        ...props,
      }),
    { wrapper },
  );

afterEach(() => vi.clearAllMocks());

describe('useWorkspaceFormDialog (create)', () => {
  it('refuses a blank name without calling the server', () => {
    const { result } = renderSubject();

    act(() => result.current.onFieldChange('name', '   '));
    act(() => result.current.onSubmit());

    expect(result.current.errors.name).toBe('This field is required');
    expect(createFn).not.toHaveBeenCalled();
  });

  it('omits blank optional fields rather than sending empty strings', async () => {
    createFn.mockResolvedValue(savedRow);
    const { result } = renderSubject();

    act(() => result.current.onFieldChange('name', 'Acme'));
    act(() => result.current.onFieldChange('city', 'Springfield'));
    act(() => result.current.onSubmit());

    await waitFor(() => expect(createFn).toHaveBeenCalled());
    expect(createFn).toHaveBeenCalledWith({ name: 'Acme', city: 'Springfield' }, expect.anything());
  });

  // A1: the statutory name had a precondition in filing and no write path at
  // all. These two assert the write path EXISTS, in the direction the old suite
  // never checked: not that filing refuses without it, but that the form can
  // supply it.
  it('sends the statutory legal name', async () => {
    createFn.mockResolvedValue(savedRow);
    const { result } = renderSubject();

    act(() => result.current.onFieldChange('name', 'Acme'));
    act(() =>
      result.current.onFieldChange('legalName', '  Acme Holdings Limited Liability Company  '),
    );
    act(() => result.current.onSubmit());

    await waitFor(() => expect(createFn).toHaveBeenCalled());
    expect(createFn).toHaveBeenCalledWith(
      { name: 'Acme', legalName: 'Acme Holdings Limited Liability Company' },
      expect.anything(),
    );
  });

  it('leaves the statutory name out entirely when it is blank, like its siblings', async () => {
    createFn.mockResolvedValue(savedRow);
    const { result } = renderSubject();

    act(() => result.current.onFieldChange('name', 'Acme'));
    act(() => result.current.onFieldChange('legalName', '   '));
    act(() => result.current.onSubmit());

    await waitFor(() => expect(createFn).toHaveBeenCalled());
    expect(createFn).toHaveBeenCalledWith({ name: 'Acme' }, expect.anything());
  });

  it('closes, toasts and hands the saved row back on success', async () => {
    createFn.mockResolvedValue(savedRow);
    const { result } = renderSubject();

    act(() => result.current.onFieldChange('name', 'Acme'));
    act(() => result.current.onSubmit());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedRow));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalledWith('Workspace added');
  });

  it('pins a duplicate name to the name field', async () => {
    createFn.mockRejectedValue({ data: { appCode: 'ALREADY_EXISTS' }, message: 'dup' });
    const { result } = renderSubject();

    act(() => result.current.onFieldChange('name', 'Northwind'));
    act(() => result.current.onSubmit());

    await waitFor(() =>
      expect(result.current.errors.name).toBe('A workspace with that name already exists'),
    );
  });
});

describe('useWorkspaceFormDialog (edit)', () => {
  it('seeds the form from the row being edited, NULL columns as blanks', () => {
    const { result } = renderSubject({ mode: 'edit', workspace: existing });

    expect(result.current.values).toEqual({
      name: 'Northwind',
      legalName: 'Northwind Traders Limited',
      street: 'Main St 1',
      postalCode: '12345',
      city: 'Springfield',
    });
  });

  it('sends null for a blanked field so the column is cleared, not kept', async () => {
    updateFn.mockResolvedValue({ ...existing, city: null });
    const { result } = renderSubject({ mode: 'edit', workspace: existing });

    act(() => result.current.onFieldChange('city', ''));
    act(() => result.current.onSubmit());

    await waitFor(() => expect(updateFn).toHaveBeenCalled());
    expect(updateFn).toHaveBeenCalledWith(
      {
        workspaceId: 'f-1',
        name: 'Northwind',
        legalName: 'Northwind Traders Limited',
        street: 'Main St 1',
        postalCode: '12345',
        city: null,
      },
      expect.anything(),
    );
    expect(toastSuccess).toHaveBeenCalledWith('Workspace updated');
  });

  it('can set a statutory name on a Workspace that never had one', async () => {
    const blank: Workspace = { ...existing, legalName: null };
    updateFn.mockResolvedValue({ ...blank, legalName: 'Northwind S.A.' });
    const { result } = renderSubject({ mode: 'edit', workspace: blank });

    expect(result.current.values.legalName).toBe('');
    act(() => result.current.onFieldChange('legalName', 'Northwind S.A.'));
    act(() => result.current.onSubmit());

    await waitFor(() => expect(updateFn).toHaveBeenCalled());
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'f-1', legalName: 'Northwind S.A.' }),
      expect.anything(),
    );
  });

  it('re-seeds when pointed at a different workspace', () => {
    const { result, rerender } = renderHook(
      (props: IWorkspaceFormDialogProps) => useWorkspaceFormDialog(props),
      {
        wrapper,
        initialProps: {
          open: true,
          onOpenChange,
          mode: 'edit',
          workspace: existing,
        } as IWorkspaceFormDialogProps,
      },
    );
    expect(result.current.values.name).toBe('Northwind');

    rerender({
      open: true,
      onOpenChange,
      mode: 'edit',
      workspace: { ...savedRow, id: 'f-2', name: 'Beta' },
    });
    expect(result.current.values.name).toBe('Beta');
  });
});
