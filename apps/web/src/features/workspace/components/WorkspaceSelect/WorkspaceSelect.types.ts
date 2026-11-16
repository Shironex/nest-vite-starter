import type { Workspace } from '@repo/shared/schemas';
import type { WorkspaceFormMode } from '../WorkspaceFormDialog';

export interface IWorkspaceSelectProps {
  /** The selected Workspace id, or empty string for "none / all". */
  readonly value: string;
  readonly onChange: (workspaceId: string) => void;
  /**
   * Offer an "all workspaces" option. Filters set this; a create form does not,
   * because the record it creates must belong to exactly one Workspace.
   */
  readonly allowEmpty?: boolean;
  /**
   * Show the inline "add workspace" affordance, and with a selection the "edit
   * workspace" one. Both are ADMIN-only at the router; this only hides them.
   */
  readonly allowCreate?: boolean;
  /** Render the field label. Off when the caller supplies its own. */
  readonly showLabel?: boolean;
  /**
   * Bind the trigger to a caller-owned `<label htmlFor>`.
   *
   * Required whenever `showLabel` is false, because the generated id below is
   * unknowable from outside: a caller that renders its own label and cannot
   * name the trigger leaves the control with no accessible name at all, which
   * is what happened on the employer-invite form.
   */
  readonly id?: string;
  readonly disabled?: boolean;
  /** Marks the trigger invalid for a form that requires a selection. */
  readonly hasError?: boolean;
  /**
   * Marks the picker mandatory, announced on the trigger.
   *
   * Every schema behind this picker makes the workspace required, and until this
   * existed nothing said so: a screen-reader user learned a field was mandatory
   * only by submitting and reading the error.
   */
  readonly required?: boolean;
  /** Id of an element describing the control, e.g. a hand-wired error line. */
  readonly describedBy?: string;
  /**
   * Injected by `FormControl`'s Slot when this picker is inside a `FormField`,
   * and forwarded to the trigger. Without them the error message is rendered
   * but never associated, and the control announces itself valid while the
   * resolver refuses to submit.
   */
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
}

export interface IWorkspaceSelectView {
  /** Generated id tying the visible label to the trigger. See the hook. */
  readonly fieldId: string;
  readonly workspaces: readonly Workspace[];
  readonly isLoading: boolean;
  readonly hasError: boolean;
  /** Refetch the workspace list after a failed load. */
  readonly onRetry: () => void;
  readonly isEmpty: boolean;
  /** Which ADMIN dialog is open, or null. */
  readonly dialogMode: WorkspaceFormMode | null;
  /** The selected row, resolved from the list; what the edit dialog seeds from. */
  readonly selectedWorkspace: Workspace | undefined;
  readonly labels: IWorkspaceSelectLabels;
  readonly onOpenCreate: () => void;
  readonly onOpenEdit: () => void;
  readonly onDialogOpenChange: (open: boolean) => void;
  /** Select what was just created or edited. */
  readonly onSaved: (workspace: Workspace) => void;
}

/** Translated copy, resolved in the hook so the shell stays free of `t()`. */
export interface IWorkspaceSelectLabels {
  readonly select: string;
  readonly placeholder: string;
  readonly all: string;
  readonly empty: string;
  readonly emptyHint: string;
  readonly add: string;
  readonly edit: string;
  readonly loadError: string;
  readonly retry: string;
  readonly search: string;
  readonly noMatch: string;
  readonly loading: string;
}
