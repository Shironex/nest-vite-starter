import type { Workspace } from '@repo/shared/schemas';
import type { WorkspaceFormMode } from '../WorkspaceFormDialog';

/** One Workspace as its table row renders it: every cell already a display string. */
export interface IWorkspaceRowView {
  readonly id: string;
  readonly name: string;
  /** The statutory name, shown under the working label when it differs. */
  readonly legalName: string | null;
  readonly address: string;
  /** The accessible name of the row's edit button, which names the workspace. */
  readonly editLabel: string;
  /** The wire row, handed to the edit dialog to seed itself from. */
  readonly workspace: Workspace;
}

export interface IWorkspaceListPageView {
  readonly rows: readonly IWorkspaceRowView[];
  /** What the list card shows. Anything but `ready` replaces the table. */
  readonly state: 'ready' | 'loading' | 'empty' | 'error';
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  /**
   * The caller is an ADMIN. Create and edit are ADMIN-only at the router, so a
   * USER gets the same list with no write affordance; the server still refuses
   * either way, this only keeps the screen from offering what it cannot do.
   */
  readonly canManage: boolean;
  /** Which dialog is open, or null. */
  readonly dialogMode: WorkspaceFormMode | null;
  /** The row being edited while `dialogMode` is `edit`. */
  readonly editing: Workspace | undefined;
  readonly onOpenCreate: () => void;
  readonly onOpenEdit: (workspace: Workspace) => void;
  readonly onDialogOpenChange: (open: boolean) => void;
  readonly onRetry: () => void;
  /** "Showing 3 of 12", or null while the list is not on screen. */
  readonly summary: string | null;
  readonly labels: IWorkspaceListPageLabels;
}

/** Translated copy, resolved in the hook so the shell stays free of `t()`. */
export interface IWorkspaceListPageLabels {
  readonly add: string;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly columnName: string;
  readonly columnAddress: string;
  readonly columnActions: string;
  readonly edit: string;
  readonly loading: string;
  /** Already chosen between the no-workspaces and the no-match empty states. */
  readonly emptyTitle: string;
  readonly emptyHint: string;
  readonly loadError: string;
  readonly retry: string;
}
