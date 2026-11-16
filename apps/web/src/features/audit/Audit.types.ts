import type { StatusTone } from '@repo/ui/status-pill';

/**
 * The question the audit trail answers most often, promoted to a one-click
 * chip instead of being buried in the event-type dropdown: every failed
 * sign-in.
 */
export type AuditQuickFilter = 'failedLogins';

/** One changed field, both sides already formatted for display. */
export interface IAuditFieldChange {
  readonly field: string;
  /** null renders as the "-" empty marker (a field that had no value). */
  readonly before: string | null;
  readonly after: string | null;
}

/** One metadata entry, value already formatted for display. */
export interface IAuditMetaEntry {
  readonly key: string;
  readonly value: string;
}

/** Everything one feed row needs, precomputed off the wire item. */
export interface IAuditRowView {
  readonly id: string;
  readonly actorName: string;
  readonly actorInitials: string;
  readonly isSystem: boolean;
  readonly actionLabel: string;
  readonly actionTone: StatusTone;
  /** Field-level before/after pairs, when the row carries snapshots. */
  readonly changes: readonly IAuditFieldChange[];
  /** Changed-field names from `metadata.fields` (values were kept out by design). */
  readonly changedFields: readonly string[];
  /** Remaining metadata entries, minus the keys surfaced elsewhere. */
  readonly metaEntries: readonly IAuditMetaEntry[];
  readonly targetLabel: string | null;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly correlationId: string | null;
  readonly success: boolean;
  readonly whenLabel: string;
}

/** A select option pair. */
export interface IAuditSelectOption {
  readonly value: string;
  readonly label: string;
}
