import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@repo/shared/schemas';
import WorkspaceSelect from './WorkspaceSelect';

const workspaceRow = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'f-1',
  name: 'Northwind Ltd',
  legalName: null,
  street: null,
  postalCode: null,
  city: null,
  ...overrides,
});

const state = vi.hoisted(() => ({
  workspaces: [] as unknown[],
  isLoading: false,
  hasError: false,
  isEmpty: false,
  dialogMode: null as 'create' | 'edit' | null,
  onRetry: vi.fn(),
  selectedWorkspace: undefined as unknown,
  onOpenCreate: vi.fn(),
  onOpenEdit: vi.fn(),
  onDialogOpenChange: vi.fn(),
  onSaved: vi.fn(),
}));

vi.mock('./WorkspaceSelect.hooks', () => ({
  useWorkspaceSelect: () => ({
    fieldId: 'workspace-select-test',
    workspaces: state.workspaces,
    isLoading: state.isLoading,
    hasError: state.hasError,
    isEmpty: state.isEmpty,
    dialogMode: state.dialogMode,
    selectedWorkspace: state.selectedWorkspace,
    labels: {
      select: 'Workspace',
      placeholder: 'Choose a workspace',
      all: 'All workspaces',
      empty: 'No workspaces yet',
      emptyHint: 'Add the first workspace to get started.',
      add: 'Add workspace',
      edit: 'Edit workspace',
      loadError: 'Failed to load workspaces',
      search: 'Search workspaces',
      noMatch: 'No matching workspaces',
      loading: 'Loading...',
      retry: 'Try again',
    },
    onRetry: state.onRetry,
    onOpenCreate: state.onOpenCreate,
    onOpenEdit: state.onOpenEdit,
    onDialogOpenChange: state.onDialogOpenChange,
    onSaved: state.onSaved,
  }),
}));

// The dialog owns a tRPC mutation pair of its own; a stub keeps this a pure
// shell test and the dialog's behavior lives in its own spec.
vi.mock('../WorkspaceFormDialog', () => ({
  WorkspaceFormDialog: (props: { mode: string }) => (
    <div data-testid="workspace-form-dialog" data-mode={props.mode} />
  ),
}));

state.workspaces = [workspaceRow(), workspaceRow({ id: 'f-2', name: 'Beta S.A.' })];

const props = { value: '', onChange: vi.fn() };

describe('WorkspaceSelect', () => {
  it('labels the trigger so the picker is reachable by name', () => {
    render(<WorkspaceSelect {...props} />);
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeInTheDocument();
  });

  it('hides the create affordance unless it is allowed', () => {
    render(<WorkspaceSelect {...props} />);
    expect(screen.queryByRole('button', { name: /Add workspace/ })).not.toBeInTheDocument();
  });

  it('opens the create dialog when creation is allowed', () => {
    render(<WorkspaceSelect {...props} allowCreate />);
    fireEvent.click(screen.getByRole('button', { name: /Add workspace/ }));
    expect(state.onOpenCreate).toHaveBeenCalled();
  });

  it('offers edit only when a workspace is selected', () => {
    render(<WorkspaceSelect {...props} allowCreate />);
    expect(screen.queryByRole('button', { name: 'Edit workspace' })).not.toBeInTheDocument();

    state.selectedWorkspace = workspaceRow();
    render(<WorkspaceSelect {...props} value="f-1" allowCreate />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit workspace' }));
    expect(state.onOpenEdit).toHaveBeenCalled();
    state.selectedWorkspace = undefined;
  });

  it('keeps edit hidden without the create/manage affordance gate', () => {
    state.selectedWorkspace = workspaceRow();
    render(<WorkspaceSelect {...props} value="f-1" />);
    expect(screen.queryByRole('button', { name: 'Edit workspace' })).not.toBeInTheDocument();
    state.selectedWorkspace = undefined;
  });

  it('surfaces a load failure instead of rendering an empty picker silently', () => {
    state.hasError = true;
    render(<WorkspaceSelect {...props} />);
    expect(screen.getByText('Failed to load workspaces')).toBeInTheDocument();
    // Announced, not just drawn: a disabled picker with no explanation is what
    // a screen-reader user is otherwise left with.
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load workspaces');
    state.hasError = false;
  });

  it('offers a way back from a failed load', () => {
    // A failed workspace list blocks any form that needs a workspace, and an
    // initial-load failure produces no toast either.
    state.hasError = true;
    render(<WorkspaceSelect {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.onRetry).toHaveBeenCalled();
    state.hasError = false;
  });

  it('points a fresh organization at creating its first workspace', () => {
    state.isEmpty = true;
    state.workspaces = [];
    render(<WorkspaceSelect {...props} allowCreate />);
    expect(screen.getByText('Add the first workspace to get started.')).toBeInTheDocument();
    state.isEmpty = false;
    state.workspaces = [workspaceRow(), workspaceRow({ id: 'f-2', name: 'Beta S.A.' })];
  });

  it('mounts the dialog in the mode the hook is holding', () => {
    state.dialogMode = 'edit';
    state.selectedWorkspace = workspaceRow();
    render(<WorkspaceSelect {...props} value="f-1" allowCreate />);
    expect(screen.getByTestId('workspace-form-dialog')).toHaveAttribute('data-mode', 'edit');
    state.dialogMode = null;
    state.selectedWorkspace = undefined;
  });

  it('keeps the dialog unmounted while closed', () => {
    render(<WorkspaceSelect {...props} allowCreate />);
    expect(screen.queryByTestId('workspace-form-dialog')).not.toBeInTheDocument();
  });
});

/**
 * The picker sits inside react-hook-form on create sheets and in hand-wired
 * forms. Both need the control itself to carry
 * what the form knows about it.
 */
describe('WorkspaceSelect as a form control', () => {
  it('forwards a ref to the trigger, so a rejected field can be focused', () => {
    const ref = createRef<HTMLButtonElement>();

    render(<WorkspaceSelect {...props} ref={ref} />);

    expect(ref.current).toBe(screen.getByRole('combobox', { name: 'Workspace' }));
  });

  it('announces a mandatory picker as required', () => {
    render(<WorkspaceSelect {...props} required />);

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toHaveAttribute(
      'aria-required',
      'true',
    );
  });

  it('says nothing about required when the picker is a filter', () => {
    render(<WorkspaceSelect {...props} />);

    expect(screen.getByRole('combobox', { name: 'Workspace' })).not.toHaveAttribute(
      'aria-required',
    );
  });

  it('passes a hand-wired error id through to the trigger', () => {
    render(<WorkspaceSelect {...props} describedBy="invite-workspace-error" />);

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toHaveAttribute(
      'aria-describedby',
      'invite-workspace-error',
    );
  });

  it('passes what FormControl injects through to the trigger', () => {
    render(<WorkspaceSelect {...props} aria-invalid aria-describedby="form-item-message" />);

    const trigger = screen.getByRole('combobox', { name: 'Workspace' });
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', 'form-item-message');
  });
});
