import { Button } from '@repo/ui/button';
import { ListSurface, ListSurfaceFooter } from '@repo/ui/list-surface';
import { Pagination } from '@repo/ui/pagination';
import { Skeleton } from '@repo/ui/skeleton';
import { StatusPill } from '@repo/ui/status-pill';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { useAuditLogSection } from './AuditLogSection.hooks';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings } from '@/lib/strings';

const MUTED_LINE_CLASS = 'type-body-small text-text-muted';
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5'];
const EMPTY_VALUE = '-';

/**
 * The read-only audit list under the users table: who did what, on which
 * target, and when. Deliberately lean: no filters, no row details and no
 * export. A fork that needs inspection tooling builds it on `audit.list`.
 */
export default function AuditLogSection() {
  const v = useAuditLogSection();

  const skeletons = SKELETON_KEYS.map((key) => <Skeleton key={key} className="h-10 w-full" />);
  const rows = v.rows.map((row) => (
    <TableRow key={row.id} data-slot="audit-row">
      <TableCell className="font-mono text-xs whitespace-nowrap text-text-secondary">
        {row.whenLabel}
      </TableCell>
      <TableCell className="type-body-medium">{row.actorName}</TableCell>
      <TableCell>
        <StatusPill tone={row.actionTone}>{row.actionLabel}</StatusPill>
      </TableCell>
      <TableCell className="text-sm text-text-secondary">
        {row.targetLabel ?? EMPTY_VALUE}
      </TableCell>
    </TableRow>
  ));

  const refreshingProps = v.isRefreshing
    ? { 'aria-busy': true, className: 'opacity-60 transition-opacity' }
    : {};

  const footer =
    v.pagination === null ? undefined : (
      <ListSurfaceFooter>
        <Pagination
          hasPrevious={v.pagination.hasPrevious}
          hasNext={v.pagination.hasNext}
          onPrevious={v.pagination.onPrevious}
          onNext={v.pagination.onNext}
          isBusy={v.pagination.isBusy}
          labels={{
            summary: v.pagination.summary,
            label: v.pagination.label,
            previous: commonStrings.pagination.previous,
            next: commonStrings.pagination.next,
          }}
        />
      </ListSurfaceFooter>
    );

  return (
    <section data-slot="admin-audit-section" className="space-y-4">
      <div className="space-y-1">
        <h2 className="type-heading-h3 text-text">{adminStrings.audit.title}</h2>
        <p className={MUTED_LINE_CLASS}>{adminStrings.audit.description}</p>
      </div>

      <ListSurface
        state={v.state}
        loading={<div className="w-full space-y-3">{skeletons}</div>}
        empty={<p className={MUTED_LINE_CLASS}>{adminStrings.audit.empty}</p>}
        error={
          // role="alert" inside: ListSurface wraps its placeholders in a status
          // region and a failed read is not a status.
          <div role="alert" className="space-y-3">
            <p className={MUTED_LINE_CLASS}>{adminStrings.audit.loadError}</p>
            <Button variant="outline" size="sm" onClick={v.onRetry}>
              {commonStrings.actions.retry}
            </Button>
          </div>
        }
        footer={footer}
      >
        <Table {...refreshingProps}>
          <TableHeader>
            <TableRow>
              <TableHead>{adminStrings.audit.columns.when}</TableHead>
              <TableHead>{adminStrings.audit.columns.actor}</TableHead>
              <TableHead>{adminStrings.audit.columns.action}</TableHead>
              <TableHead>{adminStrings.audit.columns.target}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>
      </ListSurface>
    </section>
  );
}
