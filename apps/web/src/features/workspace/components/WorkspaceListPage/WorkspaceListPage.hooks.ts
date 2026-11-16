import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ROLES } from '@repo/shared/permissions';
import type { Workspace } from '@repo/shared/schemas';
import { useAuth } from '@/hooks/use-auth';
import { APP_LOCALE } from '@/lib/i18n/format';
import { useSetTopbarSubtitle } from '@/stores/topbar-store';
// Side effect: attaches this feature's catalogs before the first t() call, so
// a hook rendered in isolation (a *.hooks.test.tsx) has the copy too.
import { WORKSPACE_NS } from '../../Workspace.i18n';
import { useWorkspaceList } from '../../Workspaces.queries';
import type { WorkspaceFormMode } from '../WorkspaceFormDialog';
import type { IWorkspaceListPageView, IWorkspaceRowView } from './WorkspaceListPage.types';

/** What an empty registration cell shows: the column is optional, not missing. */
const EMPTY_VALUE = '-';

/** "Main St 1, 12345 Springfield", from whichever of the three parts are set. */
function addressOf(workspace: Workspace): string {
  const locality = [workspace.postalCode, workspace.city].filter((part) => part !== null).join(' ');
  const parts = [workspace.street, locality === '' ? null : locality].filter(
    (part) => part !== null,
  );
  return parts.length === 0 ? EMPTY_VALUE : parts.join(', ');
}

/**
 * Case-insensitive match on the fields a person actually types: the working
 * name, the statutory name and the city. Client-side on purpose: `workspaces.list` is unpaginated and already in
 * memory, so there is nothing for a server round trip to add.
 */
function matches(workspace: Workspace, needle: string): boolean {
  if (needle === '') return true;
  const haystack = [workspace.name, workspace.legalName, workspace.city]
    .filter((value) => value !== null)
    .map((value) => value.toLocaleLowerCase(APP_LOCALE));
  return haystack.some((value) => value.includes(needle));
}

function toRow(workspace: Workspace, t: TFunction<'workspace'>): IWorkspaceRowView {
  return {
    id: workspace.id,
    name: workspace.name,
    legalName:
      workspace.legalName !== null && workspace.legalName !== workspace.name
        ? workspace.legalName
        : null,
    address: addressOf(workspace),
    editLabel: t('list.editFor', { name: workspace.name }),
    workspace,
  };
}

/**
 * The Workspaces screen: every workspace of the caller's organization, and for an
 * ADMIN the way to add one or correct its registration data.
 *
 * Unpaginated, like the procedure behind it. An organization's client roster is tens of
 * rows and `workspaces.list` returns all of them by design (the pickers want the
 * whole list), so a pager here would page through data that is already on the
 * client. The search box narrows instead, and the footer says how many of the
 * total are on screen.
 *
 * Create and edit reuse `WorkspaceFormDialog`, the same dialog the picker opens, so
 * the validation and the duplicate-name mapping are the ones every other
 * Workspace write path already has.
 */
export function useWorkspaceListPage(): IWorkspaceListPageView {
  const { t } = useTranslation(WORKSPACE_NS);
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [dialogMode, setDialogMode] = useState<WorkspaceFormMode | null>(null);
  const [editing, setEditing] = useState<Workspace | undefined>(undefined);

  useSetTopbarSubtitle(t('list.subtitle'));

  const list = useWorkspaceList();
  const workspaces = list.data?.workspaces ?? [];
  const needle = search.trim().toLocaleLowerCase(APP_LOCALE);
  const visible = workspaces.filter((workspace) => matches(workspace, needle));
  const isFiltered = needle !== '';
  const canManage = user?.role === ROLES.ADMIN;

  const state = list.isError
    ? 'error'
    : list.isPending
      ? 'loading'
      : visible.length === 0
        ? 'empty'
        : 'ready';

  const emptyHint = isFiltered
    ? t('list.noMatchHint')
    : canManage
      ? t('list.emptyHintAdmin')
      : t('list.emptyHintMember');

  return {
    rows: visible.map((workspace) => toRow(workspace, t)),
    state,
    search,
    onSearchChange: setSearch,
    canManage,
    dialogMode,
    editing,
    onOpenCreate: () => {
      setEditing(undefined);
      setDialogMode('create');
    },
    onOpenEdit: (workspace) => {
      setEditing(workspace);
      setDialogMode('edit');
    },
    onDialogOpenChange: (open) => {
      if (!open) {
        setDialogMode(null);
        setEditing(undefined);
      }
    },
    // A failed first load has nothing on screen for the query cache's refetch
    // toast to refer to, so the retry is the only way back short of a reload.
    onRetry: () => void list.refetch(),
    summary:
      state === 'ready'
        ? t('list.summary', { shown: visible.length, total: workspaces.length })
        : null,
    labels: {
      add: t('add'),
      searchLabel: t('list.searchLabel'),
      searchPlaceholder: t('list.searchPlaceholder'),
      columnName: t('list.columnName'),
      columnAddress: t('list.columnAddress'),
      columnActions: t('list.columnActions'),
      edit: t('edit'),
      loading: t('list.loading'),
      emptyTitle: isFiltered ? t('list.noMatchTitle') : t('list.emptyTitle'),
      emptyHint,
      loadError: t('list.loadError'),
      retry: t('actions.retry', { ns: 'common' }),
    },
  };
}
