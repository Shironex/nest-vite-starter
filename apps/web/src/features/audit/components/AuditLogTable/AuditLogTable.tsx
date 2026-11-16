import { Fragment } from 'react';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { ListSurface, ListSurfaceFooter } from '@repo/ui/list-surface';
import { Pagination } from '@repo/ui/pagination';
import { Skeleton } from '@repo/ui/skeleton';
import { StatusPill } from '@repo/ui/status-pill';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away, and
// without this import the screen would render bare i18n keys under test.
import '../../Audit.i18n';
import { AuditLogDetails } from '../AuditLogDetails';
import { useAuditLogTable } from './AuditLogTable.hooks';
import type { IAuditRowView } from '../../Audit.types';
import type { IAuditLogTableProps } from './AuditLogTable.types';

const COLUMN_COUNT = 5;
const SKELETON_ROW_KEYS = ['s1', 's2', 's3', 's4', 's5'];
const EMPTY_VALUE = '-';
/** How many changed-field chips the collapsed row shows before "+N". */
const SUMMARY_CHIP_LIMIT = 3;

/**
 * The collapsed row's details cell: the first field change as the design's
 * red-to-green pill pair (the diff is the point of the screen, so it is
 * visible without expanding), or the changed-field chips, or the terse
 * fallback the row can actually support.
 */
function AuditRowSummary({ row }: { readonly row: IAuditRowView }) {
  const firstChange = row.changes[0];
  const moreChanges = row.changes.length - 1;
  const chipFields = row.changedFields.slice(0, SUMMARY_CHIP_LIMIT);
  const moreChips = row.changedFields.length - chipFields.length;
  const chips = chipFields.map((field) => (
    <StatusPill key={field} tone="neutral" className="font-mono">
      {field}
    </StatusPill>
  ));
  const fallback = row.reason ?? row.targetLabel;

  if (firstChange !== undefined) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs text-text-secondary">{firstChange.field}</span>
        <span className="inline-flex items-center rounded-full bg-danger-bg px-2 py-0.5 type-label-caption text-danger line-through">
          {firstChange.before ?? EMPTY_VALUE}
        </span>
        <ArrowRight className="size-3 text-text-tertiary" aria-hidden="true" />
        <span className="inline-flex items-center rounded-full bg-success-bg px-2 py-0.5 type-label-caption text-success">
          {firstChange.after ?? EMPTY_VALUE}
        </span>
        {moreChanges > 0 && <span className="text-xs text-text-tertiary">+{moreChanges}</span>}
      </span>
    );
  }

  if (chips.length > 0) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {chips}
        {moreChips > 0 && <span className="text-xs text-text-tertiary">+{moreChips}</span>}
      </span>
    );
  }

  if (fallback !== null) {
    return <span className="text-sm text-text-secondary">{fallback}</span>;
  }

  return null;
}

/**
 * The audit feed. Each row expands in place (a second, full-width row) rather
 * than opening a drawer: an inspection walks many rows quickly, and keeping
 * several open for comparison is the point.
 */
export default function AuditLogTable({
  rows,
  state,
  isRefreshing,
  pagination,
  empty,
  error,
}: IAuditLogTableProps) {
  const v = useAuditLogTable();

  /*
   * The refresh is shown ON the rows rather than instead of them: the table
   * dims and reports itself busy while the next window is fetched, so nothing
   * moves and assistive technology is told the content is being replaced.
   */
  const refreshingProps = isRefreshing
    ? { 'aria-busy': true, className: 'opacity-60 transition-opacity' }
    : {};

  // Bars rather than a skeleton `<table>`: the shared surface centers whatever
  // it is given for a non-ready state, and the placeholder must not be a table
  // that shifts sideways the moment real rows replace it.
  const skeletonRows = SKELETON_ROW_KEYS.map((key) => (
    <Skeleton key={key} className="h-10 w-full" />
  ));

  const bodyRows = rows
    .map((row) => ({
      row,
      isExpanded: v.isExpanded(row.id),
      initialsClass: row.isSystem
        ? 'flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle type-label-caption text-text-tertiary'
        : 'flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 type-label-caption text-brand-ink',
    }))
    .map(({ row, isExpanded, initialsClass }) => (
      <Fragment key={row.id}>
        <TableRow data-slot="audit-row">
          <TableCell className="w-10 align-top">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? v.labels.collapse : v.labels.expand}
              onClick={() => v.onToggle(row.id)}
            >
              {isExpanded ? (
                <ChevronUp className="size-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4" aria-hidden="true" />
              )}
            </Button>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-3">
              <span className={initialsClass} aria-hidden="true">
                {row.actorInitials}
              </span>
              <span className="type-body-strong text-text">{row.actorName}</span>
            </div>
          </TableCell>
          <TableCell>
            <StatusPill tone={row.actionTone}>{row.actionLabel}</StatusPill>
          </TableCell>
          <TableCell>
            <AuditRowSummary row={row} />
          </TableCell>
          <TableCell className="text-right font-mono text-xs whitespace-nowrap text-text-secondary">
            {row.whenLabel}
          </TableCell>
        </TableRow>
        {isExpanded && (
          <TableRow data-slot="audit-row-details" className="hover:bg-transparent">
            <TableCell />
            <TableCell colSpan={COLUMN_COUNT - 1}>
              <AuditLogDetails row={row} />
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    ));

  /*
   * Prev/next with a stated position, and no page numbers. `audit.list` carries
   * no total by design, so there is nothing to draw buttons from; a degraded
   * footer is the honest answer rather than an invented one.
   */
  const footer =
    pagination === null ? undefined : (
      <ListSurfaceFooter>
        <Pagination
          hasPrevious={pagination.hasPrevious}
          hasNext={pagination.hasNext}
          onPrevious={pagination.onPrevious}
          onNext={pagination.onNext}
          isBusy={pagination.isBusy}
          labels={{
            summary: pagination.summary,
            label: pagination.label,
            previous: v.labels.previous,
            next: v.labels.next,
          }}
        />
      </ListSurfaceFooter>
    );

  return (
    <ListSurface
      data-slot="audit-log-table"
      state={state}
      loading={<div className="w-full space-y-3">{skeletonRows}</div>}
      empty={empty}
      error={error}
      footer={footer}
    >
      <Table {...refreshingProps}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>{v.labels.actor}</TableHead>
            <TableHead>{v.labels.action}</TableHead>
            <TableHead>{v.labels.details}</TableHead>
            <TableHead className="text-right">{v.labels.when}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{bodyRows}</TableBody>
      </Table>
    </ListSurface>
  );
}
