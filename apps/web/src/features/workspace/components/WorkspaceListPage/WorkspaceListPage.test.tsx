import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@repo/shared/schemas';
import WorkspaceListPage from './WorkspaceListPage';
import type { IWorkspaceListPageView, IWorkspaceRowView } from './WorkspaceListPage.types';

const workspace: Workspace = {
  id: 'f-1',
  name: 'Northwind',
  legalName: 'Northwind Ltd',
  street: 'Main St 1',
  postalCode: '12345',
  city: 'Springfield',
};

const row: IWorkspaceRowView = {
  id: 'f-1',
  name: 'Northwind',
  legalName: 'Northwind Ltd',
  address: 'Main St 1, 12345 Springfield',
  editLabel: 'Edit workspace Northwind',
  workspace,
};

const baseView = (overrides: Partial<IWorkspaceListPageView> = {}): IWorkspaceListPageView => ({
  rows: [row],
  state: 'ready',
  search: '',
  onSearchChange: vi.fn(),
  canManage: true,
  dialogMode: null,
  editing: undefined,
  onOpenCreate: vi.fn(),
  onOpenEdit: vi.fn(),
  onDialogOpenChange: vi.fn(),
  onRetry: vi.fn(),
  summary: 'Showing 1 of 1',
  labels: {
    add: 'Add workspace',
    searchLabel: 'Search workspaces',
    searchPlaceholder: 'Search',
    columnName: 'Name',
    columnAddress: 'Address',
    columnActions: 'Actions',
    edit: 'Edit workspace',
    loading: 'Loading workspaces…',
    emptyTitle: 'No workspaces yet',
    emptyHint: 'Add the first workspace',
    loadError: 'Could not load the workspaces',
    retry: 'Try again',
  },
  ...overrides,
});

const { useView } = vi.hoisted(() => ({ useView: vi.fn() }));

vi.mock('./WorkspaceListPage.hooks', () => ({ useWorkspaceListPage: () => useView() }));
vi.mock('../WorkspaceFormDialog', () => ({
  WorkspaceFormDialog: (props: { mode: string; workspace?: Workspace }) => (
    <div data-testid="workspace-form-dialog" data-mode={props.mode}>
      {props.workspace?.name}
    </div>
  ),
}));

describe('WorkspaceListPage', () => {
  it('renders one row per workspace with its details', () => {
    useView.mockReturnValue(baseView());
    render(<WorkspaceListPage />);

    const tableRow = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(tableRow).getByText('Northwind')).toBeInTheDocument();
    expect(within(tableRow).getByText('Northwind Ltd')).toBeInTheDocument();
    expect(within(tableRow).getByText('Main St 1, 12345 Springfield')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1')).toBeInTheDocument();
  });

  it('offers add and per-row edit to an ADMIN, naming the workspace on the button', () => {
    const view = baseView();
    useView.mockReturnValue(view);
    render(<WorkspaceListPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add workspace' }));
    expect(view.onOpenCreate).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit workspace Northwind' }));
    expect(view.onOpenEdit).toHaveBeenCalledWith(workspace);
  });

  // The router refuses create and update for a USER; the screen must not offer
  // a write it cannot complete.
  it('offers no write affordance to a USER', () => {
    useView.mockReturnValue(baseView({ canManage: false }));
    render(<WorkspaceListPage />);

    expect(screen.queryByRole('button', { name: 'Add workspace' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit workspace Northwind' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Northwind')).toBeInTheDocument();
  });

  it('mounts the shared dialog in the mode the hook asks for, seeded with the row', () => {
    useView.mockReturnValue(baseView({ dialogMode: 'edit', editing: workspace }));
    render(<WorkspaceListPage />);

    const dialog = screen.getByTestId('workspace-form-dialog');
    expect(dialog).toHaveAttribute('data-mode', 'edit');
    expect(dialog).toHaveTextContent('Northwind');
  });

  it('replaces the table with the empty state rather than a bare header row', () => {
    useView.mockReturnValue(baseView({ rows: [], state: 'empty', summary: null }));
    render(<WorkspaceListPage />);

    expect(screen.getByText('No workspaces yet')).toBeInTheDocument();
    expect(screen.getByText('Add the first workspace')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the loading line while the first load is in flight', () => {
    useView.mockReturnValue(baseView({ rows: [], state: 'loading', summary: null }));
    render(<WorkspaceListPage />);

    expect(screen.getByText('Loading workspaces…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('announces a load failure and retries on request', () => {
    const view = baseView({ rows: [], state: 'error', summary: null });
    useView.mockReturnValue(view);
    render(<WorkspaceListPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the workspaces');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(view.onRetry).toHaveBeenCalled();
  });
});
