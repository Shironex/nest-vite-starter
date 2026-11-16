import { ArrowRight } from 'lucide-react';
import { StatusPill } from '@repo/ui/status-pill';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away, and
// without this import the screen would render bare i18n keys under test.
import '../../Audit.i18n';
import { useAuditLogDetails } from './AuditLogDetails.hooks';
import type { IAuditLogDetailsProps } from './AuditLogDetails.types';

/** Rendered in place of a side the row has no value for. */
const EMPTY_VALUE = '-';

/**
 * The expanded body of one audit row: the before/after field diff when the
 * row carries snapshots (the design card's red-to-green pill pairs), the
 * changed-field chips when the writer recorded names only (a writer that
 * keeps PII values out of the trail by design), and the remaining context.
 */
export default function AuditLogDetails({ row }: IAuditLogDetailsProps) {
  const v = useAuditLogDetails();

  const changeRows = row.changes.map((change) => (
    <div key={change.field} className="flex flex-wrap items-center gap-2">
      <span className="min-w-[10rem] font-mono text-xs text-text-secondary">{change.field}</span>
      <span className="inline-flex items-center rounded-full bg-danger-bg px-2 py-0.5 type-label-caption text-danger line-through">
        {change.before ?? EMPTY_VALUE}
      </span>
      <ArrowRight className="size-3 text-text-tertiary" aria-hidden="true" />
      <span className="inline-flex items-center rounded-full bg-success-bg px-2 py-0.5 type-label-caption text-success">
        {change.after ?? EMPTY_VALUE}
      </span>
    </div>
  ));

  const fieldChips = row.changedFields.map((field) => (
    <StatusPill key={field} tone="neutral" className="font-mono">
      {field}
    </StatusPill>
  ));

  const metaRows = row.metaEntries.map((entry) => (
    <div key={entry.key} className="flex flex-wrap gap-2">
      <dt className="min-w-[10rem] font-mono text-xs text-text-tertiary">{entry.key}</dt>
      <dd className="font-mono text-xs text-text-secondary">{entry.value}</dd>
    </div>
  ));

  const hasChanges = changeRows.length > 0;
  const hasFieldChips = fieldChips.length > 0;
  const hasMeta = metaRows.length > 0;
  const hasAnything =
    hasChanges ||
    hasFieldChips ||
    hasMeta ||
    row.reason !== null ||
    row.targetLabel !== null ||
    row.ipAddress !== null ||
    row.userAgent !== null ||
    row.correlationId !== null;

  const footerParts = [
    row.ipAddress !== null ? `${v.labels.ip}: ${row.ipAddress}` : null,
    row.correlationId !== null ? `${v.labels.correlationId}: ${row.correlationId}` : null,
  ].filter((part): part is string => part !== null);
  const footer = footerParts.join(' | ');

  return (
    <div data-slot="audit-log-details" className="space-y-3 py-1">
      {!hasAnything && <p className="text-sm text-text-tertiary">{v.labels.noDetails}</p>}

      {row.targetLabel !== null && (
        <p className="text-sm text-text-secondary">
          <span className="text-text-tertiary">{v.labels.target}: </span>
          {row.targetLabel}
        </p>
      )}

      {hasChanges && (
        <div className="space-y-1.5">
          <p className="type-label-overline text-text-tertiary">{v.labels.changes}</p>
          <div className="space-y-1.5">{changeRows}</div>
        </div>
      )}

      {hasFieldChips && (
        <div className="space-y-1.5">
          <p className="type-label-overline text-text-tertiary">{v.labels.changedFields}</p>
          <div className="flex flex-wrap gap-1.5">{fieldChips}</div>
        </div>
      )}

      {row.reason !== null && (
        <p className="text-sm text-text-secondary">
          <span className="text-text-tertiary">{v.labels.reason}: </span>
          {row.reason}
        </p>
      )}

      {hasMeta && (
        <div className="space-y-1.5">
          <p className="type-label-overline text-text-tertiary">{v.labels.metadata}</p>
          <dl className="space-y-1">{metaRows}</dl>
        </div>
      )}

      {row.userAgent !== null && (
        <p className="text-xs text-text-tertiary">
          {v.labels.userAgent}: {row.userAgent}
        </p>
      )}

      {footer !== '' && <p className="font-mono text-xs text-text-tertiary">{footer}</p>}
    </div>
  );
}
