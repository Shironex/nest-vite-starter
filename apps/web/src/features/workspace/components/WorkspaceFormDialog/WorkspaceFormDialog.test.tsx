import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkspaceFormDialog from './WorkspaceFormDialog';
import type { IWorkspaceFormErrors } from './WorkspaceFormDialog.types';

const state = vi.hoisted(() => ({
  errors: {} as IWorkspaceFormErrors,
  isSubmitting: false,
  onFieldChange: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
}));

vi.mock('./WorkspaceFormDialog.hooks', () => ({
  useWorkspaceFormDialog: () => ({
    title: 'New workspace',
    description: 'Add the first workspace to get started.',
    values: {
      name: '',
      legalName: '',
      street: '',
      postalCode: '',
      city: '',
    },
    errors: state.errors,
    isSubmitting: state.isSubmitting,
    isEdit: false,
    labels: {
      name: 'Workspace name',
      legalName: 'Legal name',
      street: 'Street and number',
      postalCode: 'Postal code',
      city: 'City',
      registrationHint: 'The legal name and address are optional.',
      legalNameHint: 'The full registered name, if it differs from the short one.',
      submit: 'Add workspace',
      cancel: 'Cancel',
    },
    onFieldChange: state.onFieldChange,
    onSubmit: state.onSubmit,
    onCancel: state.onCancel,
  }),
}));

const props = { open: true, onOpenChange: vi.fn(), mode: 'create' as const };

describe('WorkspaceFormDialog', () => {
  it('renders every registration field with an accessible label', () => {
    render(<WorkspaceFormDialog {...props} />);
    for (const label of [
      'Workspace name',
      'Legal name',
      'Street and number',
      'Postal code',
      'City',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('ties only the error to the statutory name input when it is invalid', () => {
    state.errors = { legalName: 'This field is required' };
    render(<WorkspaceFormDialog {...props} />);
    expect(screen.getByLabelText('Legal name')).toHaveAttribute(
      'aria-describedby',
      'workspace-legalName-error',
    );
    state.errors = {};
  });

  it('routes typing to the field-change handler', () => {
    render(<WorkspaceFormDialog {...props} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Springfield' } });
    expect(state.onFieldChange).toHaveBeenCalledWith('city', 'Springfield');
  });

  it('announces an inline error and marks the input invalid', () => {
    state.errors = { name: 'This field is required' };
    render(<WorkspaceFormDialog {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This field is required');
    expect(screen.getByLabelText('Workspace name')).toHaveAttribute('aria-invalid', 'true');
    state.errors = {};
  });

  it('locks the submit while the write is in flight', () => {
    state.isSubmitting = true;
    render(<WorkspaceFormDialog {...props} />);
    expect(screen.getByRole('button', { name: 'Add workspace' })).toBeDisabled();
    state.isSubmitting = false;
  });

  it('submits and cancels through the hook handlers', () => {
    render(<WorkspaceFormDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add workspace' }));
    expect(state.onSubmit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.onCancel).toHaveBeenCalled();
  });
});
