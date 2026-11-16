import { Pencil, Plus } from 'lucide-react';
import { Button } from '@repo/ui/button';
import {
  ListSurface,
  ListSurfaceFooter,
  ListToolbar,
  ListToolbarActions,
  ListToolbarSearch,
} from '@repo/ui/list-surface';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { ListSearchField } from '@/features/shared/components/ListSearchField';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away.
import '../../Workspace.i18n';
import { WorkspaceFormDialog } from '../WorkspaceFormDialog';
import { useWorkspaceListPage } from './WorkspaceListPage.hooks';

/** Supporting copy in the placeholders. */
const MUTED_LINE_CLASS = 'type-body-regular text-text-muted';

/**
 * The Workspaces screen: the workspaces of the caller's organization, the second tier
 * of the Organization -> Workspace boundary.
 *
 * It renders no `<h1>`: the app shell's topbar owns the page heading, and the
 * hook publishes the strapline into the topbar's subtitle slot.
 *
 * The add and edit buttons render for an ADMIN only. That is a courtesy that
 * keeps a USER from being offered a write the router refuses: `workspaces.create`
 * and `workspaces.update` carry `AdminMiddleware`, and that is the control.
 */
export default function WorkspaceListPage() {
  const v = useWorkspaceListPage();

  const rows = v.rows.map((row) => (
    <TableRow key={row.id} data-slot="workspace-row">
      <TableCell className="align-top">
        <p className="type-body-medium text-text">{row.name}</p>
        {row.legalName !== null && (
          <p className="type-body-small text-text-muted">{row.legalName}</p>
        )}
      </TableCell>
      <TableCell className="align-top">{row.address}</TableCell>
      {v.canManage && (
        <TableCell className="text-right align-top">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={row.editLabel}
            onClick={() => v.onOpenEdit(row.workspace)}
          >
            <Pencil className="size-4" aria-hidden="true" />
            <span>{v.labels.edit}</span>
          </Button>
        </TableCell>
      )}
    </TableRow>
  ));

  const footer =
    v.summary === null ? undefined : (
      <ListSurfaceFooter>
        <p className="type-body-small text-text-muted">{v.summary}</p>
      </ListSurfaceFooter>
    );

  return (
    <div data-slot="workspace-list-page" className="flex flex-col gap-4">
      <ListToolbar>
        <ListToolbarSearch>
          <ListSearchField
            value={v.search}
            onValueChange={v.onSearchChange}
            label={v.labels.searchLabel}
            placeholder={v.labels.searchPlaceholder}
          />
        </ListToolbarSearch>
        {v.canManage && (
          <ListToolbarActions>
            <Button type="button" size="sm" onClick={v.onOpenCreate}>
              <Plus className="size-4" aria-hidden="true" />
              <span>{v.labels.add}</span>
            </Button>
          </ListToolbarActions>
        )}
      </ListToolbar>

      <ListSurface
        state={v.state}
        loading={<p className={MUTED_LINE_CLASS}>{v.labels.loading}</p>}
        empty={
          <>
            <p className="type-body-strong text-text">{v.labels.emptyTitle}</p>
            <p className={MUTED_LINE_CLASS}>{v.labels.emptyHint}</p>
          </>
        }
        error={
          // role="alert" inside: ListSurface wraps its placeholders in a status
          // region, and a failed read is not a status.
          <div role="alert" className="flex flex-col items-center gap-3">
            <p className="type-body-regular text-danger">{v.labels.loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={v.onRetry}>
              {v.labels.retry}
            </Button>
          </div>
        }
        footer={footer}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{v.labels.columnName}</TableHead>
              <TableHead>{v.labels.columnAddress}</TableHead>
              {v.canManage && <TableHead className="sr-only">{v.labels.columnActions}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>
      </ListSurface>

      {v.dialogMode !== null && (
        <WorkspaceFormDialog
          open
          mode={v.dialogMode}
          workspace={v.editing}
          onOpenChange={v.onDialogOpenChange}
        />
      )}
    </div>
  );
}
