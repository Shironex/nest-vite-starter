import { useId, useState } from 'react';
import type { Workspace } from '@repo/shared/schemas';
import { useWorkspaceList } from '../../Workspaces.queries';
import type { WorkspaceFormMode } from '../WorkspaceFormDialog';
import type { IWorkspaceSelectProps, IWorkspaceSelectView } from './WorkspaceSelect.types';
import { workspaceStrings } from '@/features/workspace/Workspace.strings';
import { commonStrings } from '@/lib/strings';

/**
 * The workspace picker, shared by every screen that filters or files by
 * workspace.
 *
 * It lives in the `workspace` platform feature (and reads its copy from the `workspace`
 * namespace, which it registers itself): every one of those features may
 * import `workspace`, and none of them may import each other.
 *
 * The inline create path exists because self-signup provisions an organization with NO
 * Workspace at all: without it, a brand-new tenant could never record its first
 * workspace-scoped record. Edit rides the same affordance gate, so the registration data
 * (legal name, address) can be corrected from wherever the workspace is
 * picked, not only from the Workspaces screen. Both are ADMIN-only at the router;
 * `allowCreate` only hides them, the server is the boundary.
 */
export function useWorkspaceSelect({
  value,
  onChange,
  id,
}: IWorkspaceSelectProps): IWorkspaceSelectView {
  const [dialogMode, setDialogMode] = useState<WorkspaceFormMode | null>(null);
  /*
   * Generated rather than a literal: this picker renders on several list screens
   * and forms, and two of those can be on screen at once (a filter panel behind an open dialog). A hardcoded id
   * would tie one `<label>` to whichever trigger mounted first.
   */
  const generatedId = useId();
  // A caller-supplied id wins, so a form that renders its own label can bind to
  // the trigger. Falls back to the generated one for every other call site.
  const fieldId = id ?? generatedId;

  const list = useWorkspaceList();

  const workspaces = list.data?.workspaces ?? [];
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === value);

  function onSaved(workspace: Workspace) {
    // Select what was just created or edited: the user opened the dialog
    // because this is the workspace they are working with.
    onChange(workspace.id);
  }

  return {
    fieldId,
    workspaces,
    isLoading: list.isLoading,
    hasError: list.isError,
    // A failed workspace list blocks any form that needs a workspace, and the query
    // cache only toasts a refetch that had data to begin with: without this
    // the only way out of a first-load failure is a page reload.
    onRetry: () => void list.refetch(),
    isEmpty: !list.isLoading && !list.isError && workspaces.length === 0,
    dialogMode,
    selectedWorkspace,
    labels: {
      select: workspaceStrings.select,
      placeholder: workspaceStrings.placeholder,
      all: workspaceStrings.all,
      empty: workspaceStrings.empty,
      emptyHint: workspaceStrings.emptyHint,
      add: workspaceStrings.add,
      edit: workspaceStrings.edit,
      loadError: workspaceStrings.loadError,
      retry: commonStrings.actions.retry,
      search: workspaceStrings.search,
      noMatch: workspaceStrings.noMatch,
      loading: commonStrings.states.loading,
    },
    onOpenCreate: () => setDialogMode('create'),
    onOpenEdit: () => setDialogMode('edit'),
    onDialogOpenChange: (open) => setDialogMode(open ? dialogMode : null),
    onSaved,
  };
}
